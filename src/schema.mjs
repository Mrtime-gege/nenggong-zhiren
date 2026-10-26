/**
 * 能工智人 · conservative JSON Schema validator for tool arguments and
 * response_format. It intentionally ignores unknown keywords instead of
 * rejecting data, so gateway-specific schema extensions do not break tools.
 *
 * Supported: type (string or array), enum, const, required, properties,
 * additionalProperties (boolean), items (schema or tuple), min/maxLength,
 * min/maxItems, minimum/maximum, anyOf, oneOf, allOf.
 */

const MAX_DEPTH = 24;
const MAX_ERRORS = 20;

function pathJoin(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return `${path}.${key}`;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  return typeof value;
}

function typeMatches(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function addError(errors, path, message) {
  if (errors.length >= MAX_ERRORS) return;
  errors.push({ path, message });
}

function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

function validateInternal(value, schema, path, errors, depth) {
  if (errors.length >= MAX_ERRORS) return;
  if (depth > MAX_DEPTH) {
    addError(errors, path, "schema nesting is too deep");
    return;
  }
  if (schema === true || schema === undefined || schema === null) return;
  if (schema === false) {
    addError(errors, path, "value is not allowed by schema");
    return;
  }
  if (typeof schema !== "object" || Array.isArray(schema)) return;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      addError(errors, path, `expected ${types.join(" | ")}, got ${jsonType(value)}`);
      return;
    }
  }

  if (schema.const !== undefined && !sameJson(value, schema.const)) {
    addError(errors, path, "value does not match const");
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJson(value, item))) {
    addError(errors, path, `value must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateInternal(value, sub, path, errors, depth + 1);
  }
  if (Array.isArray(schema.anyOf)) {
    const alternatives = schema.anyOf.map((sub) => {
      const local = [];
      validateInternal(value, sub, path, local, depth + 1);
      return local;
    });
    if (!alternatives.some((local) => local.length === 0)) {
      addError(errors, path, "value does not match any allowed schema");
    }
  }
  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const sub of schema.oneOf) {
      const local = [];
      validateInternal(value, sub, path, local, depth + 1);
      if (local.length === 0) matches += 1;
    }
    if (matches !== 1) addError(errors, path, "value must match exactly one allowed schema");
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      addError(errors, path, `must contain at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      addError(errors, path, `must contain at most ${schema.maxLength} characters`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      addError(errors, path, `must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      addError(errors, path, `must be <= ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      addError(errors, path, `must be > ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      addError(errors, path, `must be < ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      addError(errors, path, `must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      addError(errors, path, `must contain at most ${schema.maxItems} items`);
    }
    if (Array.isArray(schema.items)) {
      for (let index = 0; index < Math.min(value.length, schema.items.length); index += 1) {
        validateInternal(value[index], schema.items[index], pathJoin(path, index), errors, depth + 1);
      }
    } else if (schema.items && typeof schema.items === "object") {
      for (let index = 0; index < value.length; index += 1) {
        validateInternal(value[index], schema.items, pathJoin(path, index), errors, depth + 1);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties =
      schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) addError(errors, path, `missing required property '${key}'`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) validateInternal(value[key], sub, pathJoin(path, key), errors, depth + 1);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) addError(errors, pathJoin(path, key), "additional property is not allowed");
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          validateInternal(value[key], schema.additionalProperties, pathJoin(path, key), errors, depth + 1);
        }
      }
    }
  }
}

/**
 * @param {unknown} value parsed tool arguments / response JSON
 * @param {object} schema JSON Schema
 * @returns {{ok: boolean, errors: {path: string, message: string}[]}}
 */
export function validateJsonSchema(value, schema) {
  const errors = [];
  validateInternal(value, schema, "$", errors, 0);
  return { ok: errors.length === 0, errors };
}

export function formatSchemaErrors(errors, limit = 3) {
  return errors
    .slice(0, limit)
    .map((error) => `${error.path}: ${error.message}`)
    .join("; ");
}
