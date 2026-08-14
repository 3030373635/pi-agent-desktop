const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";

type FrontmatterParts = {
  opening: string;
  yaml: string;
  closing: string;
  rest: string;
  newline: "\n" | "\r\n";
};

function splitFrontmatter(content: string): FrontmatterParts | null {
  const match = /^(---)(\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
  if (!match) return null;
  return {
    opening: `${match[1]}${match[2]}`,
    yaml: match[3],
    closing: match[4],
    rest: content.slice(match[0].length),
    newline: match[2] as "\n" | "\r\n",
  };
}

/**
 * Surgically updates the one frontmatter key owned by the skills UI.
 * Existing duplicate lines are collapsed so files written by older versions
 * become parseable again, while all unrelated YAML formatting is preserved.
 */
export function setSkillModelInvocationDisabled(
  content: string,
  disabled: boolean,
): string {
  const parts = splitFrontmatter(content);
  if (!parts) {
    if (!disabled) return content;
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    return `---${newline}${DISABLE_MODEL_INVOCATION_KEY}: true${newline}---${newline}${content}`;
  }

  const keyLine = new RegExp(
    `^${DISABLE_MODEL_INVOCATION_KEY}[ \\t]*:.*(?:\\r?\\n|$)`,
    "gm",
  );
  let found = false;
  let yaml = parts.yaml.replace(keyLine, () => {
    if (!disabled || found) return "";
    found = true;
    return `${DISABLE_MODEL_INVOCATION_KEY}: true${parts.newline}`;
  });

  if (disabled && !found) {
    yaml = `${DISABLE_MODEL_INVOCATION_KEY}: true${parts.newline}${yaml}`;
  } else if (yaml.endsWith(parts.newline)) {
    // The closing delimiter already owns the separator newline.
    yaml = yaml.slice(0, -parts.newline.length);
  }

  return `${parts.opening}${yaml}${parts.closing}${parts.rest}`;
}
