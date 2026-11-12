// CP437 對照表：第 n 個字就是字碼 n，也是字元表上的第 n 格（16 格一列）
// 0 與 255 在字元表上是空白

const ROWS = [
  ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼',
  '►◄↕‼¶§▬↨↑↓→←∟↔▲▼',
  ' !"#$%&\'()*+,-./',
  '0123456789:;<=>?',
  '@ABCDEFGHIJKLMNO',
  'PQRSTUVWXYZ[\\]^_',
  '`abcdefghijklmno',
  'pqrstuvwxyz{|}~⌂',
  'ÇüéâäàåçêëèïîìÄÅ',
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ',
  'áíóúñÑªº¿⌐¬½¼¡«»',
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐',
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧',
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀',
  'αßΓπΣσµτΦΘΩδ∞φε∩',
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
];

export const CP437 = ROWS.flatMap((r) => [...r]);

const INDEX = new Map();
CP437.forEach((c, i) => {
  if (!INDEX.has(c)) INDEX.set(c, i);
});

// 字 → 字元表的格號；不在表裡的回傳 -1
export function cp437Index(ch) {
  return INDEX.has(ch) ? INDEX.get(ch) : -1;
}
