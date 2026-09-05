/** Generate complete, no-JS-capable Persian pages from the existing English site.
 * Run: node --experimental-strip-types scripts/build-company-locales.ts [--check]
 * English text is checked before translation so a changed source cannot silently
 * ship with an old translation. No new dependencies: use web's existing jsdom.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, 'web/package.json'));
const { JSDOM } = require('jsdom');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
type Translation = readonly [selector: string, english: string, persian: string];

const landing: Translation[] = [
  ['.noscript-note', 'JavaScript is off — showing the still version of the film.', 'جاوااسکریپت غیرفعال است؛ نسخهٔ بدون حرکت نمایش داده می‌شود.'],
  ['.telemetry .live', 'NEURAI_PLATFORM // AI-NATIVE', '<i></i>NeurAI Platform · هوش‌مصنوعی‌محور'],
  ['.telemetry .seg:nth-child(2)', 'FIRST APPECHO', 'اولین اپ<b>اکو</b>'],
  ['.telemetry .seg:nth-child(3)', 'ACCESSCALLER-SCOPED', 'دسترسی<b>در محدودهٔ کاربر</b>'],
  ['.telemetry .seg:nth-child(4)', 'CONTROLHUMAN APPROVAL', 'کنترل<b>تأیید انسان</b>'],
  ['.telemetry .seg:nth-child(5)', 'FOCUSTHE PLATFORM', 'تمرکز<b id="hud-focus">پلتفرم</b>'],
  ['.login span', 'LOGIN', 'ورود'],
  ['#boot-kick', 'ARRIVAL', 'آغاز'],
  ['#boot-b1', 'We build intelligence into the fabric of work.', 'هوشمندی را در تار و پود کار می‌سازیم.'],
  ['#boot-b2', 'Agents do the work. People keep the decisions.', 'عامل‌ها کار می‌کنند؛ تصمیم با انسان می‌ماند.'],
  ['#boot-tags span:nth-child(1)', 'FIRST APP: ECHO', 'اولین اپ: اکو'],
  ['#boot-tags span:nth-child(2)', 'PERSIAN-FIRST', 'فارسی، از همان ابتدا'],
  ['#boot-tags span:nth-child(3)', 'AGENTS: ROYA · AVA', 'عامل‌ها: رویا · آوا'],
  ['[data-fx="s1-kicker"]', 'WHO_WE_ARE', 'ما که هستیم'],
  ['[data-fx="s1-title"]', 'An AI-native company, not a company with AI.', 'از پایه هوش‌مصنوعی‌محور، نه صرفاً مجهز به آن.'],
  ['[data-fx="s1-lead"]', "Most software waits to be used. Ours shows up for work. NeurAI Platform brings named agents into your team's work — with your permissions, traceable sources, and human control.", 'بیشتر نرم‌افزارها منتظر استفاده‌اند؛ نرم‌افزار ما <b>دست‌به‌کار می‌شود</b>. <bdi>NeurAI Platform</bdi> عامل‌های نام‌دار را با دسترسی شما، منابع قابل‌ردیابی و کنترل انسانی به تیم می‌آورد.'],
  ['[data-fx="s1-c1"] h3', 'AGENTS_AS_COLLEAGUES', 'عامل‌ها، همکار شما'],
  ['[data-fx="s1-c1"] p', 'Every product starts from the work an agent can take off your hands. It answers when named, hands off to another, and proposes — a person confirms.', 'هر محصول از کاری شروع می‌شود که یک عامل می‌تواند از دوش شما بردارد. با نام بردنش پاسخ می‌دهد، کار را به عامل دیگری می‌سپارد و پیشنهاد می‌دهد؛ تأیید با انسان است.'],
  ['[data-fx="s1-c2"] h3', 'SECURITY_AS_STRUCTURE', 'امنیت در ساختار'],
  ['[data-fx="s1-c2"] p', 'Access control lives in the database wall, not in a prompt. An agent borrows your authority — never more — and its database role cannot delete a thing.', 'کنترل دسترسی در پایگاه داده اعمال می‌شود، نه در متن دستور. عامل فقط با اختیار شما عمل می‌کند، نه بیشتر؛ نقش پایگاه دادهٔ آن هیچ مجوز حذفی ندارد.'],
  ['[data-fx="s1-c3"] h3', 'LANGUAGES_OTHERS_SKIP', 'فارسی از پایه'],
  ['[data-fx="s1-c3"] p', 'Persian-first, right-to-left, engineered for scripts and calendars global tools treat as an afterthought.', 'از ابتدا فارسی و راست‌به‌چپ؛ طراحی‌شده برای خط‌ها و تقویم‌هایی که در ابزارهای جهانی معمولاً در اولویت نیستند.'],
  ['[data-fx="s1-meta"] span:nth-child(1)', "AUTHORITY THE CALLER'S", 'اختیار<b> متعلق به کاربر</b>'],
  ['[data-fx="s1-meta"] span:nth-child(2)', 'SECURITY DATABASE-ENFORCED', 'امنیت<b> اعمال‌شده در پایگاه داده</b>'],
  ['[data-fx="s2-kicker"]', 'THE_AGENTS', 'عامل‌ها'],
  ['[data-fx="s2-title"]', 'Name an agent. It answers, acts, and hands off.', 'نامش را صدا بزنید؛ پاسخ می‌دهد، عمل می‌کند و همکاری می‌کند.'],
  ['[data-fx="s2-lead"]', 'Echo, our first app, turns recordings into speaker-labelled transcripts and versioned summaries. Ask @roya about work in flight, or @ava to analyse the record. They work within your access and can hand off to each other. Inferred changes are proposed for review; an email draft waits for you to press Send.', '<span class="echo-mark">اکو</span>، اولین اپ ما، فایل‌های ضبط‌شده را به متن با تفکیک گوینده و خلاصه‌های نسخه‌بندی‌شده تبدیل می‌کند. از <b><bdi>@roya</bdi></b> دربارهٔ کارهای جاری بپرسید یا تحلیل سوابق را به <b><bdi>@ava</bdi></b> بسپارید. آن‌ها در محدودهٔ دسترسی شما کار می‌کنند و می‌توانند کار را به یکدیگر بسپارند. تغییرات استنباط‌شده <b>برای بازبینی پیشنهاد می‌شوند</b>؛ پیش‌نویس ایمیل منتظر می‌ماند تا خودتان «ارسال» را بزنید.'],
  ['[data-fx="s2-meta"] span:nth-child(1)', 'SOURCE THE TRANSCRIPT', 'منبع<b> متن پیاده‌شده</b>'],
  ['[data-fx="s2-meta"] span:nth-child(2)', 'HANDOFF @ROYA → @AVA', 'واگذاری<b> <bdi>@roya → @ava</bdi></b>'],
  ['[data-fx="s2-meta"] span:nth-child(3)', 'CONTROL HUMAN REVIEW', 'کنترل<b> بازبینی انسان</b>'],
  ['.mock-bar em', 'ROOM // PRODUCT_TEAM', 'اتاق // تیم محصول'],
  ['.mock-row:nth-child(2) .mock-chip', 'ROYA · ANSWER', 'رویا · پاسخ'],
  ['.mock-row:nth-child(4) .mock-chip', 'AVA · PROPOSAL', 'آوا · پیشنهاد'],
  ['[data-fx="s3-kicker"]', 'THE_PLATFORM', 'پلتفرم'],
  ['[data-fx="s3-title"]', 'One platform. Many minds.', 'یک پلتفرم، ذهن‌های بسیار.'],
  ['[data-fx="s3-lead"]', 'One login, one design language, one security wall — and the working day inside it: rooms where agents answer when named, a board where a project is an order, meetings that record themselves and end in signed minutes, mail that arrives already drafted.', 'یک ورود، یک زبان طراحی و یک مرز امنیتی مشترک برای تمام روز کاری: اتاق‌هایی که عامل‌ها با صدا زدن نامشان پاسخ می‌دهند؛ تابلویی که در آن <b>پروژه یک دستور کار است</b>؛ جلساتی که ضبط می‌شوند و به <b>صورت‌جلسهٔ امضاشده</b> می‌رسند؛ و ایمیل‌هایی که پیش‌نویسشان آماده است.'],
  ['[data-fx="s3-t1"] .l', 'PERSIAN WORD ERROR RATE · ONE REFERENCE CLIP, 13 AUG 2026', 'نرخ خطای واژه در فارسی · یک کلیپ مرجع، ۲۲ مرداد ۱۴۰۵'],
  ['[data-fx="s3-t2"] .l', 'LANGUAGES · PERSIAN-FIRST AND ENGLISH', 'زبان‌ها · فارسی در اولویت، همراه با انگلیسی'],
  ['[data-fx="s3-t3"] .l', "DELETE PERMISSIONS FOR THE AGENT'S DATABASE ROLE", 'مجوز حذف برای نقش پایگاه دادهٔ عامل'],
  ['[data-fx="s3-meta"] span:nth-child(1)', 'PLATFORM ONE SHARED PERMISSION WALL', 'پلتفرم<b> یک مرز دسترسی مشترک</b>'],
  ['[data-fx="s3-meta"] span:nth-child(2)', 'SURFACES ROOMS · BOARD · MEETINGS · MAIL', 'فضاها<b> اتاق‌ها · تابلو · جلسات · ایمیل</b>'],
  ['[data-fx="s4-kicker"]', 'SIGN_OFF', 'سخن آخر'],
  ['[data-fx="s4-title"]', 'Work is about to do itself.', 'کارها در آستانهٔ انجام شدن‌اند.'],
  ['[data-fx="s4-sub"]', 'You keep the last word.', 'حرف آخر همچنان با شماست.'],
  ['.foot-meta span', '© 2026 NEURAI · NEURAI.PT', '<bdi>© ۲۰۲۶ NEURAI · NEURAI.PT</bdi>'],
];

const privacy: Translation[] = [
  ['.home', '← neurai.pt', '→ بازگشت به NeurAI'],
  ['h1', 'Privacy Policy', 'سیاست حریم خصوصی'],
  ['.updated', 'Last updated: 5 September 2026 · Applies to the NeurAI platform at app.neurai.pt', 'آخرین به‌روزرسانی: ۱۴ شهریور ۱۴۰۵ · مربوط به <bdi>NeurAI Platform</bdi> در <bdi>app.neurai.pt</bdi>'],
  ['h2:nth-of-type(1)', 'What NeurAI is', 'NeurAI چیست'],
  ['h2:nth-of-type(1) + p', "NeurAI is a workspace platform with named AI agents. It turns the meetings you choose to record into transcripts, summaries and minutes, keeps your team's rooms and task board, and its agents can — with your consent — read your email and calendar to draft replies and prepare you for meetings. A draft waits for you to send it; an agent never sends mail on its own.", '<bdi>NeurAI Platform</bdi> پلتفرم فضای کاری با عامل‌های هوش مصنوعی نام‌دار است. جلساتی را که خودتان برای ضبط انتخاب می‌کنید به متن، خلاصه و صورت‌جلسه تبدیل می‌کند و اتاق‌ها و تابلوی کار تیم شما را نگه می‌دارد. عامل‌ها می‌توانند با رضایت شما ایمیل و تقویمتان را بخوانند تا پاسخ‌ها را پیش‌نویس کنند و شما را برای جلسات آماده سازند. پیش‌نویس منتظر ارسال شما می‌ماند؛ عامل هرگز خودسرانه ایمیل نمی‌فرستد.'],
  ['h2:nth-of-type(2)', 'What we store', 'چه چیزهایی ذخیره می‌کنیم'],
  ['ul:nth-of-type(1) li:nth-child(1)', 'Your account: the email address and name you sign in with, your role and your organization.', '<strong>حساب شما</strong>: نشانی ایمیل و نامی که با آن وارد می‌شوید، نقش و سازمان شما.'],
  ['ul:nth-of-type(1) li:nth-child(2)', 'Your recordings and their derivatives: audio you record or upload, transcripts, summaries, tags and notes. The transcript is the source of truth; derived artifacts carry their provenance.', '<strong>فایل‌های ضبط‌شده و داده‌های مشتق‌شده از آن‌ها</strong>: صدایی که ضبط یا بارگذاری می‌کنید، متن‌ها، خلاصه‌ها، برچسب‌ها و یادداشت‌ها. متن پیاده‌شده منبع اصلی است و منشأ داده‌های مشتق‌شده ثبت می‌شود.'],
  ['ul:nth-of-type(1) li:nth-child(3)', 'Assistant activity: your conversations with the assistant, and metadata about automated runs (identifiers, timings, statuses).', '<strong>فعالیت دستیار</strong>: گفتگوهای شما با دستیار و فرادادهٔ اجراهای خودکار، شامل شناسه‌ها، زمان‌ها و وضعیت‌ها.'],
  ['h2:nth-of-type(3)', 'Google and Microsoft connections', 'اتصال به گوگل و مایکروسافت'],
  ['h2:nth-of-type(3) + p', 'Connecting Gmail, Google Calendar, Google Meet or Google Drive is a personal choice, made per user. It is never made for you by an administrator, and an administrator cannot read your mailbox, calendar or files through NeurAI.', 'اتصال جیمیل، تقویم گوگل، گوگل میت یا گوگل درایو انتخابی شخصی و جداگانه برای هر کاربر است. مدیر هرگز این انتخاب را به‌جای شما انجام نمی‌دهد و نمی‌تواند از طریق NeurAI صندوق ایمیل، تقویم یا فایل‌های شما را بخواند.'],
  ['ul:nth-of-type(2) li:nth-child(1)', 'We store an encrypted OAuth token and a reference to what we last looked at — never copies of your email or files. Message and file content is read on demand, used for the answer or draft in front of you, and not retained as content.', 'یک توکن رمزگذاری‌شدهٔ <bdi>OAuth</bdi> و ارجاعی به آخرین مورد بررسی‌شده ذخیره می‌کنیم؛ <strong>هرگز نسخه‌ای از ایمیل‌ها یا فایل‌های شما نگه نمی‌داریم</strong>. محتوای پیام و فایل در زمان نیاز خوانده می‌شود، برای همان پاسخ یا پیش‌نویس پیش روی شما به‌کار می‌رود و به‌صورت محتوا نگهداری نمی‌شود.'],
  ['ul:nth-of-type(2) li:nth-child(2)', 'Email drafts the assistant writes wait for you: nothing is sent without your explicit action. This is enforced in our database permissions, not just in software logic.', 'پیش‌نویس‌های ایمیلی که دستیار می‌نویسد منتظر شما می‌مانند: بدون اقدام صریح شما چیزی ارسال نمی‌شود. این محدودیت در مجوزهای پایگاه داده اعمال می‌شود، نه صرفاً در منطق نرم‌افزار.'],
  ['ul:nth-of-type(2) li:nth-child(3)', 'Your content is never used to train models and never sold.', 'محتوای شما <strong>هرگز برای آموزش مدل‌ها استفاده نمی‌شود</strong> و هرگز فروخته نمی‌شود.'],
  ['ul:nth-of-type(2) li:nth-child(4)', 'Disconnecting an integration revokes the token with the provider and destroys the stored credential. You can also revoke access at any time from your Google account permissions.', 'با قطع اتصال، توکن نزد ارائه‌دهنده لغو و اعتبارنامهٔ ذخیره‌شده نابود می‌شود. همچنین می‌توانید هر زمان از بخش <a href="https://myaccount.google.com/permissions">مجوزهای حساب گوگل</a> دسترسی را لغو کنید.'],
  ['ul:nth-of-type(2) + p', "NeurAI's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.", 'استفاده و انتقال اطلاعات دریافتی از APIهای گوگل در NeurAI مطابق با <a href="https://developers.google.com/terms/api-services-user-data-policy">سیاست داده‌های کاربران سرویس‌های API گوگل</a>، از جمله الزامات «استفادهٔ محدود»، انجام می‌شود.'],
  ['h2:nth-of-type(4)', 'Who can see what', 'چه کسی به چه چیزی دسترسی دارد'],
  ['h2:nth-of-type(4) + p', 'Access is enforced with row-level security in the database. Your private records are yours; records you share with your organization follow the scope you chose. Administrators govern the organization — members, settings, workflows — but do not read your personal integrations or your assistant drafts.', 'دسترسی با امنیت در سطح ردیف در پایگاه داده اعمال می‌شود. سوابق خصوصی شما متعلق به خود شماست؛ سوابقی که با سازمان به اشتراک می‌گذارید تابع محدوده‌ای است که انتخاب کرده‌اید. مدیران، اعضا، تنظیمات و گردش‌کارهای سازمان را مدیریت می‌کنند، اما اتصال‌های شخصی یا پیش‌نویس‌های دستیار شما را نمی‌خوانند.'],
  ['h2:nth-of-type(5)', 'Processors we rely on', 'ارائه‌دهندگانی که به آن‌ها تکیه می‌کنیم'],
  ['h2:nth-of-type(5) + p', 'We use hosted infrastructure and model providers to run the service (hosting, database, speech-to-text, and language-model inference). Content is sent to them only as needed to perform the task you asked for, under their confidentiality terms, and is not used by us for anything else.', 'برای اجرای سرویس از زیرساخت میزبانی‌شده و ارائه‌دهندگان مدل استفاده می‌کنیم؛ شامل میزبانی، پایگاه داده، تبدیل گفتار به متن و اجرای مدل زبانی. محتوا فقط به میزان لازم برای انجام کار درخواستی شما و تحت شرایط محرمانگی آن‌ها ارسال می‌شود و ما آن را برای هدف دیگری به‌کار نمی‌بریم.'],
  ['h2:nth-of-type(6)', 'Retention and deletion', 'نگهداری و حذف'],
  ['h2:nth-of-type(6) + p', "Deleted records enter a grace window and are then permanently purged, including the underlying audio. Disconnected integrations lose their credentials immediately. If you want your account and its data removed, ask your organization's administrator or contact us.", 'سوابق حذف‌شده ابتدا وارد مهلت بازیابی می‌شوند و سپس همراه با فایل صوتی اصلی برای همیشه پاک می‌شوند. اعتبارنامهٔ اتصال‌های قطع‌شده بلافاصله از بین می‌رود. برای حذف حساب و داده‌هایتان از مدیر سازمان درخواست کنید یا با ما تماس بگیرید.'],
  ['h2:nth-of-type(7)', 'Contact', 'تماس با ما'],
];

async function generate(input: string, output: string, rows: Translation[], title: string, description: string) {
  const dom = new JSDOM(await readFile(resolve(root, input), 'utf8'));
  const doc = dom.window.document;
  doc.documentElement.lang = 'fa';
  doc.documentElement.dir = 'rtl';
  doc.title = title;
  doc.querySelector('meta[name="description"]').content = description;
  doc.querySelector('link[rel="canonical"]').href = 'https://neurai.pt/' + output.split('/').at(-1);
  doc.querySelectorAll('.language-switch a').forEach((a: any) => {
    if (a.hreflang === 'fa') a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  doc.querySelector('.language-switch').setAttribute('aria-label', 'زبان');
  for (const [selector, english, persian] of rows) {
    const elements = doc.querySelectorAll(selector);
    assert.equal(elements.length, 1, `Translation selector must identify one subject: ${selector}`);
    const el = elements[0];
    assert.equal(normalize(el.textContent), normalize(english), `English changed; review Persian translation: ${selector}`);
    el.innerHTML = persian;
    if (el.hasAttribute('data-text')) el.dataset.text = el.textContent;
  }
  if (input.endsWith('index.html')) {
    doc.querySelector('meta[property="og:title"]').content = title;
    doc.querySelector('meta[property="og:description"]').content = 'عامل‌ها کار می‌کنند؛ تصمیم با انسان می‌ماند. NeurAI Platform، پلتفرمی بر پایهٔ هوش مصنوعی با اولویت فارسی.';
    doc.querySelector('meta[property="og:url"]').content = 'https://neurai.pt/fa.html';
    doc.querySelector('.login').href = 'https://app.neurai.pt/fa/sign-in';
    doc.querySelector('.brand-wordmark').setAttribute('aria-label', 'پلتفرم NeurAI');
    doc.querySelector('#chapters').setAttribute('aria-label', 'فصل‌ها');
    doc.querySelector('#chrome-logo').title = 'NeurAI — بازگشت به آغاز';
    doc.querySelector('#chrome-logo').setAttribute('aria-label', 'بازگشت به آغاز');
    doc.querySelector('#chrome-x').title = 'رفتن به پایان';
    doc.querySelector('#chrome-x').setAttribute('aria-label', 'رفتن به پایان روایت');
    doc.querySelectorAll('.figure .n').forEach((n: any) => {
      const value = +n.dataset.count;
      n.textContent = new Intl.NumberFormat('fa-IR', {maximumFractionDigits: 1}).format(value) + (n.dataset.suffix === '%' ? '٪' : n.dataset.suffix);
    });
  } else {
    doc.querySelector('.home').href = '/fa.html';
    // The English policy's Persian summary is redundant in the full translation.
    doc.querySelector('hr + p[lang="fa"]').remove();
    doc.querySelector('hr').remove();
  }
  const result = '<!-- Generated by scripts/build-company-locales.ts; edit its translations or the English source. -->\n' + dom.serialize().replace(/[ \t]+$/gm, '') + '\n';
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(resolve(root, output), 'utf8'), result, `${output} is stale; regenerate translations`);
  } else {
    await writeFile(resolve(root, output), result, 'utf8');
  }
  dom.window.close();
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${output}`);
}

await generate('site/index.html', 'site/fa.html', landing, 'NeurAI — شرکت هوش‌مصنوعی‌محور', 'NeurAI Platform هوشمندی را در تار و پود کار می‌سازد؛ عامل‌های نام‌دار در کنار تیم شما کار می‌کنند، با دسترسی‌های شما و تصمیم‌گیری انسانی. از ابتدا فارسی.');
await generate('site/privacy.html', 'site/privacy-fa.html', privacy, 'NeurAI — سیاست حریم خصوصی', 'NeurAI چه چیزهایی ذخیره می‌کند، از طرف شما چه اطلاعاتی می‌خواند و چگونه می‌توانید دسترسی را پس بگیرید.');
