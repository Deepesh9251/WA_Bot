'use strict';

// ──────────────────────────────────────────────────────────────────
// linkDetector.js — Instagram Reel/Post link detection
//
// Exports a single pure function: isInstagramLinkOnly(messageBody)
//
// IMPORTANT DESIGN NOTES:
//   - This is a FULL-STRING match (anchored with ^ and $).
//     The message must be NOTHING BUT the link (after trimming).
//     Any caption, emoji, or extra text = return false.
//   - Supported URL patterns:
//       instagram.com/reel/<id>
//       instagram.com/reels/<id>
//       instagram.com/p/<id>
//     With optional trailing slash and/or query string (e.g. ?igsh=...).
//   - NOT matched (intentionally):
//       instagram.com/username/       (profile page)
//       instagram.com/stories/...     (stories)
//       Any non-Instagram URL
// ──────────────────────────────────────────────────────────────────

/**
 * Regex breakdown:
 *
 *   ^                          — start of string (full-match anchor)
 *   https?:\/\/                — http:// or https://
 *   (www\.)?                   — optional www.
 *   instagram\.com\/           — literal instagram.com/
 *   (reel|reels|p)\/           — reel/, reels/, or p/
 *   [A-Za-z0-9_\-]+            — media ID (alphanumeric, underscores, hyphens)
 *   \/?                        — optional trailing slash
 *   (\?[^\s]*)?                — optional query string (?igsh=abc123 etc.)
 *   $                          — end of string (full-match anchor)
 */
const INSTAGRAM_LINK_REGEX =
  /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_\-]+\/?\?[^\s]*$|^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_\-]+\/?$/;

/**
 * Returns true ONLY if the entire message body (after trimming) is
 * an Instagram Reel or Post URL and nothing else.
 *
 * @param {string} messageBody - Raw message text from WhatsApp
 * @returns {boolean}
 */
function isInstagramLinkOnly(messageBody) {
  if (typeof messageBody !== 'string') return false;

  const trimmed = messageBody.trim();

  // Empty messages are not links
  if (trimmed.length === 0) return false;

  return INSTAGRAM_LINK_REGEX.test(trimmed);
}

module.exports = { isInstagramLinkOnly };

// ──────────────────────────────────────────────────────────────────
// INLINE TEST CASES
// Run: node src/linkDetector.js
// All 10 tests must pass (print "10/10 passed").
// ──────────────────────────────────────────────────────────────────

/* eslint-disable no-unreachable */
if (require.main === module) {
  const TESTS = [
    // [input, expectedResult, description]

    // ✅ Should return TRUE (bare reel/post links, optionally with query string)
    ['https://www.instagram.com/reel/ABC123/', true, 'reel with www + trailing slash'],
    ['https://instagram.com/p/XYZ789', true, 'post without www, no trailing slash'],
    ['https://www.instagram.com/reels/ABC123/?igsh=abc', true, 'reels with query string'],
    ['  https://www.instagram.com/reel/ABC123/  ', true, 'reel with leading/trailing whitespace (trimmed)'],
    ['https://www.instagram.com/p/Ab1-Cd_23/', true, 'post with hyphens and underscores in ID'],

    // ❌ Should return FALSE (has extra text or wrong URL)
    ['Check this out https://www.instagram.com/reel/ABC/', false, 'caption BEFORE the link'],
    ['https://www.instagram.com/reel/ABC/ wow', false, 'caption AFTER the link'],
    ['https://www.instagram.com/reel/ABC/ 🔥', false, 'emoji after the link counts as extra text'],
    ['https://twitter.com/video/123', false, 'non-Instagram URL'],
    ['https://www.instagram.com/username/', false, 'Instagram profile page — not a reel/post'],
    ['https://www.instagram.com/stories/user/123456/', false, 'Instagram Stories — not a reel/post'],
    ['', false, 'empty string'],
    [null, false, 'null input (defensive)'],
  ];

  let passed = 0;
  let failed = 0;

  for (const [input, expected, description] of TESTS) {
    const result = isInstagramLinkOnly(input);
    const ok = result === expected;
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} ${ok ? 'PASS' : 'FAIL'} | ${description}`);
    if (!ok) {
      console.log(`       Input:    ${JSON.stringify(input)}`);
      console.log(`       Expected: ${expected}`);
      console.log(`       Got:      ${result}`);
    }
    ok ? passed++ : failed++;
  }

  console.log(`\n${passed}/${passed + failed} tests passed`);
  if (failed > 0) process.exit(1);
}
