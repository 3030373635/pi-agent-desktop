const RGB_THEME_TOKENS = new Set(["accent", "danger", "success", "warning"]);
const COLOR_MIX_PATTERN = /color-mix\(\s*in (?:srgb|oklab),\s*(?:(var\(--([\w-]+)\))|(currentColor))\s+((?:\d+(?:\.\d+)?)|(?:\.\d+))%\s*,\s*(transparent|(var\(--([\w-]+)\)))\s*\)/gi;

/**
 * Convert supported color-mix forms to a Chrome 102-safe approximation.
 *
 * @param {string} value - Complete CSS declaration value to transform.
 * @returns {string} A legacy declaration value without supported color mixes.
 */
function createColorMixFallback(value) {
  return value.replace(
    COLOR_MIX_PATTERN,
    (match, firstVariable, firstToken, currentColor, weightText, secondColor) => {
      const weight = Number(weightText);
      const firstColor = firstVariable ?? currentColor;
      if (secondColor.toLowerCase() === "transparent") {
        if (RGB_THEME_TOKENS.has(firstToken)) {
          return `rgba(var(--${firstToken}-rgb), ${weight / 100})`;
        }
        // For colors without an RGB companion variable, the nearest endpoint
        // avoids turning subtle translucent effects into opaque blocks.
        return weight >= 50 ? firstColor : "transparent";
      }
      return weight >= 50 ? firstColor : secondColor;
    },
  );
}

/**
 * Create the PostCSS plugin that inserts Chrome 102 fallbacks.
 *
 * @returns {import("postcss").Plugin} PostCSS declaration visitor plugin.
 */
function chrome102Compat() {
  return {
    postcssPlugin: "postcss-chrome-102-compat",
    Declaration(declaration) {
      if (!/color-mix\(/i.test(declaration.value)) return;

      const fallbackValue = createColorMixFallback(declaration.value);
      if (fallbackValue === declaration.value || /color-mix\(/i.test(fallbackValue)) return;

      const previous = declaration.prev();
      if (previous?.type === "decl"
        && previous.prop === declaration.prop
        && previous.value === fallbackValue) {
        return;
      }
      // Old Chromium keeps this declaration while modern browsers override it
      // with the original color-mix value immediately below.
      declaration.cloneBefore({ value: fallbackValue });
    },
  };
}

// Next's webpack PostCSS loader requires a resolvable CommonJS plugin factory.
chrome102Compat.postcss = true;

module.exports = chrome102Compat;
module.exports.createColorMixFallback = createColorMixFallback;
