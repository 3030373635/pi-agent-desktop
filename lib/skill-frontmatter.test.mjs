import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { setSkillModelInvocationDisabled } = await jiti.import("./skill-frontmatter.ts");

test("adds and removes the model-invocation flag without touching other YAML", () => {
  const source = "---\nname: demo\ndescription: keep formatting\n---\nBody\n";
  const disabled = setSkillModelInvocationDisabled(source, true);
  assert.equal(
    disabled,
    "---\ndisable-model-invocation: true\nname: demo\ndescription: keep formatting\n---\nBody\n",
  );
  assert.equal(setSkillModelInvocationDisabled(disabled, false), source);
});

test("replaces explicit false and repairs duplicate keys", () => {
  const explicitFalse = "---\nname: demo\ndisable-model-invocation: false\n---\n";
  assert.equal(
    setSkillModelInvocationDisabled(explicitFalse, true),
    "---\nname: demo\ndisable-model-invocation: true\n---\n",
  );

  const duplicate = "---\ndisable-model-invocation: true\nname: demo\ndisable-model-invocation: false\n---\n";
  const repaired = setSkillModelInvocationDisabled(duplicate, true);
  assert.equal((repaired.match(/^disable-model-invocation:/gm) ?? []).length, 1);
  assert.match(repaired, /^disable-model-invocation: true$/m);
  assert.equal(
    setSkillModelInvocationDisabled(duplicate, false),
    "---\nname: demo\n---\n",
  );
});

test("preserves CRLF and creates frontmatter when needed", () => {
  const source = "---\r\nname: demo\r\ndisable-model-invocation: false\r\n---\r\nBody\r\n";
  const updated = setSkillModelInvocationDisabled(source, true);
  assert.equal(updated.replaceAll("\r\n", "").includes("\n"), false);
  assert.match(updated, /disable-model-invocation: true\r\n/);
  assert.equal(
    setSkillModelInvocationDisabled("Body\n", true),
    "---\ndisable-model-invocation: true\n---\nBody\n",
  );
  assert.equal(setSkillModelInvocationDisabled("Body\n", false), "Body\n");
});
