import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  SafeFetchError,
  fetchRemoteImage,
  isPrivateAddress,
  resolvePublicImageUrl,
} from "../src/net/safe-fetch.mjs";

test("safe fetch classifies private and public addresses", () => {
  for (const address of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  assert.equal(isPrivateAddress("not-an-ip"), true);
});

test("safe fetch rejects private hosts and non-http schemes", async () => {
  await assert.rejects(
    () => resolvePublicImageUrl("http://127.0.0.1/a.png"),
    (error) => error instanceof SafeFetchError && error.code === "private_image_host",
  );
  await assert.rejects(
    () => resolvePublicImageUrl("file:///etc/passwd"),
    (error) => error instanceof SafeFetchError && error.code === "invalid_image_scheme",
  );
  await assert.rejects(
    () => resolvePublicImageUrl("http://user:pass@example.com/a.png"),
    (error) => error instanceof SafeFetchError && error.code === "invalid_image_url",
  );
  const resolved = await resolvePublicImageUrl("https://example.com/a.png", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(resolved.url.hostname, "example.com");
  assert.deepEqual(resolved.addresses, ["93.184.216.34"]);
  await assert.rejects(
    () => resolvePublicImageUrl("https://example.com/a.png", {
      lookup: async () => [{ address: "10.0.0.5", family: 4 }],
    }),
    (error) => error instanceof SafeFetchError && error.code === "private_image_host",
  );
  await assert.rejects(
    () => resolvePublicImageUrl("https://example.com/a.png", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }],
    }),
    (error) => error instanceof SafeFetchError && error.code === "private_image_host",
  );
});

test("safe image fetch enforces type, size and redirect rules", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(png.length) });
      res.end(png);
    } else if (req.url === "/html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html></html>");
    } else if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/ok" });
      res.end();
    } else if (req.url === "/big") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.alloc(2048));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const target = (pathname, extra = {}) => ({
    url: new URL(`http://127.0.0.1:${port}${pathname}`),
    addresses: ["127.0.0.1"],
    ...extra,
  });
  try {
    const image = await fetchRemoteImage(target("/ok"));
    assert.equal(image.mime, "image/png");
    assert.deepEqual(image.buffer, png);
    await assert.rejects(
      () => fetchRemoteImage(target("/html")),
      (error) => error instanceof SafeFetchError && error.code === "image_unsupported_type",
    );
    await assert.rejects(
      () => fetchRemoteImage(target("/redirect")),
      (error) => error instanceof SafeFetchError && error.code === "image_redirect",
    );
    await assert.rejects(
      () => fetchRemoteImage(target("/big"), { maxBytes: 1024 }),
      (error) => error instanceof SafeFetchError && error.code === "image_too_large",
    );
    await assert.rejects(
      () => fetchRemoteImage(target("/missing")),
      (error) => error instanceof SafeFetchError && error.code === "image_upstream_status",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
