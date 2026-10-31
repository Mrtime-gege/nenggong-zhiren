/**
 * Per-user feature registry.
 *
 * Add a feature here to expose its admin toggle in user management. The
 * persisted user record stays a plain `{ key: boolean }` object so future
 * features do not need a migration.
 */
export const USER_FEATURES = Object.freeze([
  Object.freeze({
    key: "aiAssist",
    label: "AI 辅助",
    description: "允许使用管理员配置的 AI 摘要、翻译、起草和建议功能。",
    defaultEnabled: true,
  }),
]);

const FEATURE_BY_KEY = new Map(USER_FEATURES.map((feature) => [feature.key, feature]));

export function featureDefaults() {
  return Object.fromEntries(USER_FEATURES.map((feature) => [feature.key, feature.defaultEnabled]));
}

export function normalizeUserFeatures(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const feature of USER_FEATURES) {
    result[feature.key] = typeof source[feature.key] === "boolean" ? source[feature.key] : feature.defaultEnabled;
  }
  return result;
}

export function userAllowsFeature(user, key) {
  const feature = FEATURE_BY_KEY.get(key);
  if (!feature) return false;
  if (user?.features && typeof user.features[key] === "boolean") return user.features[key];
  return feature.defaultEnabled;
}

export function publicFeatureCatalog() {
  return USER_FEATURES.map((feature) => ({
    key: feature.key,
    label: feature.label,
    description: feature.description,
    defaultEnabled: feature.defaultEnabled,
  }));
}
