/**
 * Person-name transliteration between Persian and Latin script (user
 * directive, 2026-08-16: «امیر» renders as "Amir" in the English UI and a
 * Latin-only name renders in Persian script in the Persian UI — names
 * TRANSLITERATE on locale switch; usernames, emails and brands never do).
 *
 * **This applies to nothing but `personName()`.** It is a display fallback
 * for people who never supplied the other-script spelling of their name,
 * not a general romanizer: `display_name_en`, when present, always wins.
 *
 * Strategy, in order per word:
 *  1. Dictionary of common Iranian given names — exact hit wins. Persian
 *     omits short vowels («حمید» is h-m-y-d), so a letter map alone yields
 *     "Hmid"; only a dictionary knows the vowels are "Hamid".
 *  2. Surname suffixes: «…ی» on a dictionary stem is the family-name shape
 *     («محمدی» → mohammad + i), «…یی» → "ei" («رضایی» → rezaei).
 *  3. Compound segmentation: «امیررضا» is امیر+رضا, greedy-split against the
 *     dictionary ("Amirreza").
 *  4. Letter-map fallback — honest-rough. It cannot invent unwritten vowels,
 *     and does not try: a skeleton like "Bhrng" for an unknown «بهرنگ» is
 *     imperfect, which is the cost of a name no list has met. The fix for a
 *     person is always the same: set your own Latin name in Profile.
 */

/** Latin (lowercase) → Persian. The single source; the reverse is derived. */
const NAMES: Record<string, string> = {
  // given names
  abbas: "عباس", ahmad: "احمد", akbar: "اکبر", akram: "اکرم", ali: "علی",
  amin: "امین", amir: "امیر", arash: "آرش", arman: "آرمان", atefeh: "عاطفه",
  azadeh: "آزاده", azam: "اعظم", babak: "بابک", bagher: "باقر", bahar: "بهار",
  bahram: "بهرام", behnam: "بهنام", behzad: "بهزاد", danial: "دانیال",
  dariush: "داریوش", davood: "داوود", donya: "دنیا", ebrahim: "ابراهیم",
  elham: "الهام", elnaz: "الناز", erfan: "عرفان", esmaeil: "اسماعیل",
  farhad: "فرهاد", farid: "فرید", fatemeh: "فاطمه", ghazal: "غزل",
  habib: "حبیب", hamed: "حامد", hamid: "حمید", hanieh: "هانیه",
  hasan: "حسن", hassan: "حسن", hossein: "حسین", iman: "ایمان",
  jafar: "جعفر", javad: "جواد", kamran: "کامران", karim: "کریم",
  kaveh: "کاوه", kazem: "کاظم", khosrow: "خسرو", kian: "کیان",
  kourosh: "کوروش", laleh: "لاله", leila: "لیلا", mahdi: "مهدی",
  mahmoud: "محمود", mahnaz: "مهناز", mahsa: "مهسا", majid: "مجید",
  marjan: "مرجان", maryam: "مریم", masoud: "مسعود", mehdi: "مهدی",
  milad: "میلاد", mina: "مینا", mitra: "میترا", mohammad: "محمد",
  mojgan: "مژگان", morteza: "مرتضی", mostafa: "مصطفی", narges: "نرگس",
  nazanin: "نازنین", negar: "نگار", niloofar: "نیلوفر", nima: "نیما",
  omid: "امید", parisa: "پریسا", parsa: "پارسا", payam: "پیام",
  pedram: "پدرام", peyman: "پیمان", pouya: "پویا", ramin: "رامین",
  reza: "رضا", roghayeh: "رقیه", roya: "رویا", saeed: "سعید",
  samira: "سمیرا", sanaz: "ساناز", sara: "سارا", sasan: "ساسان",
  sepideh: "سپیده", setareh: "ستاره", shabnam: "شبنم", shadi: "شادی",
  shaghayegh: "شقایق", shahin: "شاهین", shahram: "شهرام", shirin: "شیرین",
  shohreh: "شهره", siavash: "سیاوش", simin: "سیمین", sina: "سینا",
  sohrab: "سهراب", soheila: "سهیلا", soroush: "سروش", tahereh: "طاهره",
  tavakol: "توکل", vahid: "وحید", yasaman: "یاسمن", yasamin: "یاسمین",
  yousef: "یوسف", zahra: "زهرا",
};

const FA_TO_LATIN = new Map<string, string>(
  Object.entries(NAMES).map(([latin, fa]) => [fa, latin]),
);
// Where two Latin spellings share one Persian form (hasan/hassan, mahdi/mehdi)
// the LAST entry above won the map slot; pin the conventional one instead.
FA_TO_LATIN.set("حسن", "hasan");
FA_TO_LATIN.set("مهدی", "mahdi");
FA_TO_LATIN.set("محمد", "mohammad");

/** Persian letter → Latin, the rough fallback rung. */
const FA_LETTERS: Record<string, string> = {
  "آ": "a", "ا": "a", "أ": "a", "إ": "e", "ب": "b", "پ": "p", "ت": "t",
  "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ذ": "z",
  "ر": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z",
  "ط": "t", "ظ": "z", "ع": "", "غ": "gh", "ف": "f", "ق": "gh", "ک": "k",
  "ك": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "h",
  "ی": "i", "ي": "i", "ئ": "", "ء": "", "‌": "",
};

/** Latin digraph/letter → Persian, the reverse fallback rung. */
const LATIN_DIGRAPHS: [string, string][] = [
  ["kh", "خ"], ["gh", "ق"], ["sh", "ش"], ["ch", "چ"], ["zh", "ژ"],
  ["aa", "ا"], ["ee", "ی"], ["oo", "و"], ["ou", "و"],
];
const LATIN_LETTERS: Record<string, string> = {
  b: "ب", c: "ک", d: "د", f: "ف", g: "گ", h: "ه", j: "ج", k: "ک",
  l: "ل", m: "م", n: "ن", p: "پ", q: "ق", r: "ر", s: "س", t: "ت",
  v: "و", w: "و", x: "کس", y: "ی", z: "ز", i: "ی", u: "و",
};

const cap = (word: string) => (word ? word[0]!.toUpperCase() + word.slice(1) : word);

function faWordToLatin(word: string): string {
  const hit = FA_TO_LATIN.get(word);
  if (hit) return cap(hit);
  // «…یی» is the rezaei-shaped family name; «…ی» the mohammadi-shaped one
  if (word.endsWith("یی")) {
    const stem = FA_TO_LATIN.get(word.slice(0, -2));
    if (stem) return cap(stem + "ei");
  }
  if (word.endsWith("ی")) {
    const stem = FA_TO_LATIN.get(word.slice(0, -1));
    if (stem) return cap(stem + "i");
  }
  // compounds: «امیررضا» = امیر+رضا — greedy split on dictionary halves
  for (let i = 2; i < word.length - 1; i++) {
    const a = FA_TO_LATIN.get(word.slice(0, i));
    const b = FA_TO_LATIN.get(word.slice(i));
    if (a && b) return cap(a + b);
  }
  // the rough rung: و reads v at word start, o elsewhere
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    if (ch === "و") out += i === 0 ? "v" : "o";
    else out += FA_LETTERS[ch] ?? ch;
  }
  return cap(out);
}

function latinWordToFa(word: string): string {
  const hit = NAMES[word];
  if (hit) return hit;
  if (word.endsWith("ei")) {
    const stem = NAMES[word.slice(0, -2)];
    if (stem) return stem + "یی";
  }
  if (word.endsWith("i")) {
    const stem = NAMES[word.slice(0, -1)];
    if (stem) return stem + "ی";
  }
  for (let i = 2; i < word.length - 1; i++) {
    const a = NAMES[word.slice(0, i)];
    const b = NAMES[word.slice(i)];
    if (a && b) return a + b;
  }
  // the rough rung: digraphs first, initial vowels are long, medial a/e/o
  // drop the way Persian script drops short vowels
  let out = "";
  let i = 0;
  while (i < word.length) {
    const two = word.slice(i, i + 2);
    const digraph = LATIN_DIGRAPHS.find(([d]) => d === two);
    if (digraph) {
      out += digraph[1];
      i += 2;
      continue;
    }
    const ch = word[i]!;
    if (ch === "a" || ch === "e" || ch === "o") {
      if (i === 0) out += ch === "o" ? "او" : ch === "e" ? "ا" : "ا";
      else if (i === word.length - 1 && ch === "a") out += "ا";
      // medial short vowels are unwritten in Persian
    } else {
      out += LATIN_LETTERS[ch] ?? ch;
    }
    i++;
  }
  return out;
}

/** «امیر رضایی» → "Amir Rezaei". Words the maps don't know pass through the letter rung. */
export function persianToLatin(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => faWordToLatin(w))
    .join(" ");
}

/** "Amir Rezaei" → «امیر رضایی». Case-insensitive on the way in. */
export function latinToPersian(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => latinWordToFa(w.toLowerCase()))
    .join(" ");
}
