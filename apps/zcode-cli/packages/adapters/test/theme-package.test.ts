import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectThemePackages } from "../src/plugins/index.ts";

function makeThemeRoot(): string {
  return mkdtempSync(join(tmpdir(), "zcode-themes-"));
}

test("collects valid themes and flags broken ones from default themes dir", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "sereno-dark"), { recursive: true });
    writeFileSync(
      join(root, "themes", "sereno-dark", "theme.json"),
      JSON.stringify({
        id: "sereno-dark",
        name: "Sereno Dark",
        tokens: { light: { "--color-brand": "#7c5cff" }, dark: { "--color-brand": "#9d85ff" } },
        css: "overrides.css",
      }),
    );
    writeFileSync(join(root, "themes", "sereno-dark", "overrides.css"), ".chat-bubble { border-radius: 12px; }");
    mkdirSync(join(root, "themes", "broken"), { recursive: true });
    writeFileSync(join(root, "themes", "broken", "theme.json"), "{ not json");

    const { packages } = collectThemePackages(root, undefined);
    assert.equal(packages.length, 2);
    const valid = packages.find((pkg) => pkg.themeId === "sereno-dark");
    assert.ok(valid);
    assert.equal(valid.valid, true);
    assert.equal(valid.cssStatus, "ok");
    assert.equal(valid.tokensDark["--color-brand"], "#9d85ff");
    const broken = packages.find((pkg) => pkg.themeId === "broken");
    assert.ok(broken);
    assert.equal(broken.valid, false);
    assert.match(broken.invalidReason ?? "", /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("css blacklist rejection keeps tokens usable with cssStatus rejected", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "badcss"), { recursive: true });
    writeFileSync(
      join(root, "themes", "badcss", "theme.json"),
      JSON.stringify({ id: "badcss", name: "Bad CSS", tokens: {}, css: "evil.css" }),
    );
    writeFileSync(join(root, "themes", "badcss", "evil.css"), '@import url("https://evil.example/x.css");');
    const { packages } = collectThemePackages(root, "themes");
    const pkg = packages.find((item) => item.themeId === "badcss");
    assert.ok(pkg);
    assert.equal(pkg.valid, true);
    assert.equal(pkg.cssStatus, "rejected");
    assert.match(pkg.cssRejectReason ?? "", /blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("css path escaping the theme directory is rejected", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "escape"), { recursive: true });
    writeFileSync(
      join(root, "themes", "escape", "theme.json"),
      JSON.stringify({ id: "escape", name: "Escape", tokens: {}, css: "../evil.css" }),
    );
    const { packages } = collectThemePackages(root, "themes");
    const pkg = packages.find((item) => item.themeId === "escape");
    assert.ok(pkg);
    assert.equal(pkg.cssStatus, "rejected");
    assert.match(pkg.cssRejectReason ?? "", /escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate theme ids keep the first declaration only", () => {
  const root = makeThemeRoot();
  try {
    for (const dir of ["themes-a", "themes-b"]) {
      mkdirSync(join(root, dir, "dup"), { recursive: true });
      writeFileSync(
        join(root, dir, "dup", "theme.json"),
        JSON.stringify({ id: "dup", name: `Dup-${dir}`, tokens: {} }),
      );
    }
    const { packages } = collectThemePackages(root, ["themes-a", "themes-b"]);
    assert.equal(packages.length, 1);
    assert.equal(packages[0]?.name, "Dup-themes-a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("themes directory that is a junction is skipped entirely", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "real-themes", "linked"), { recursive: true });
    writeFileSync(
      join(root, "real-themes", "linked", "theme.json"),
      JSON.stringify({ id: "linked", name: "Linked", tokens: {} }),
    );
    symlinkSync(join(root, "real-themes"), join(root, "themes"), "junction");
    const { packages } = collectThemePackages(root, undefined);
    assert.equal(packages.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest-declared themes directory that is a junction is skipped", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "real-themes", "linked"), { recursive: true });
    writeFileSync(
      join(root, "real-themes", "linked", "theme.json"),
      JSON.stringify({ id: "linked", name: "Linked", tokens: {} }),
    );
    symlinkSync(join(root, "real-themes"), join(root, "themes-link"), "junction");
    const { packages } = collectThemePackages(root, "themes-link");
    assert.equal(packages.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("declared css file that does not exist reports cssStatus missing", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "nocssfile"), { recursive: true });
    writeFileSync(
      join(root, "themes", "nocssfile", "theme.json"),
      JSON.stringify({ id: "nocssfile", name: "No CSS File", tokens: {}, css: "missing.css" }),
    );
    const { packages } = collectThemePackages(root, undefined);
    const pkg = packages.find((item) => item.themeId === "nocssfile");
    assert.ok(pkg);
    assert.equal(pkg.valid, true);
    assert.equal(pkg.cssStatus, "missing");
    assert.equal(pkg.cssText, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantically invalid theme is flagged with reserved-token reason", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "badtoken"), { recursive: true });
    writeFileSync(
      join(root, "themes", "badtoken", "theme.json"),
      JSON.stringify({ id: "badtoken", name: "Bad Token", tokens: { light: { "--font-sans": "Inter" } } }),
    );
    const { packages } = collectThemePackages(root, undefined);
    const pkg = packages.find((item) => item.themeId === "badtoken");
    assert.ok(pkg);
    assert.equal(pkg.valid, false);
    assert.match(pkg.invalidReason ?? "", /reserved/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("subdirectory without theme.json is not counted", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "empty-dir"), { recursive: true });
    mkdirSync(join(root, "themes", "ok"), { recursive: true });
    writeFileSync(
      join(root, "themes", "ok", "theme.json"),
      JSON.stringify({ id: "ok", name: "Ok", tokens: {} }),
    );
    const { packages } = collectThemePackages(root, undefined);
    assert.deepEqual(
      packages.map((item) => item.themeId),
      ["ok"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
