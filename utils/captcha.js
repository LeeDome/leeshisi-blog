// 简单的 SVG 图形验证码生成器（无第三方依赖）
const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const W = 140;
const H = 46;

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randColor() {
  return `rgb(${rand(40, 180)},${rand(40, 180)},${rand(40, 180)})`;
}

// 生成 4 位验证码，返回 { text, svg }。text 为小写字母数字，用于比对。
function generate() {
  let text = '';
  for (let i = 0; i < 4; i++) {
    text += CHARS[rand(0, CHARS.length - 1)];
  }
  const lower = text.toLowerCase();

  // 干扰线
  let particles = '';
  for (let i = 0; i < 6; i++) {
    const x1 = rand(0, W);
    const y1 = rand(0, H);
    const x2 = rand(0, W);
    const y2 = rand(0, H);
    particles += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randColor()}" stroke-opacity="0.5" stroke-width="1"/>`;
  }

  // 字符（每位随机角度与颜色）
  let chars = '';
  for (let i = 0; i < 4; i++) {
    const angle = rand(-25, 25);
    const fs = rand(22, 28);
    const x = 18 + i * 30 + rand(-3, 3);
    const y = rand(28, 36);
    chars += `<text x="${x}" y="${y}" font-size="${fs}" fill="${randColor()}" font-weight="bold" font-family="Arial, sans-serif" transform="rotate(${angle} ${x} ${y})">${text[i]}</text>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#f2f4f7" rx="4"/>` +
    particles + chars +
    `</svg>`;

  return { text: lower, svg };
}

module.exports = { generate };