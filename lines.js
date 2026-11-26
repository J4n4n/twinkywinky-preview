// Astolfo line pools + shuffle-bag engine for the twinkywinky pixel pet.
// Plain script (no modules). Load BEFORE game.js; exposes window.Lines.
// game.js / rig.js / chat.js call Lines.next(pool, ctx) instead of picking
// a hardcoded line or Math.random() from a tiny array.
//
// How it works:
// - Every pool is a "shuffle bag": its line indices are Fisher-Yates
//   shuffled, then drawn one by one. A line can only repeat after every
//   other line in its pool has been shown.
// - When a bag empties it reshuffles the FULL pool, with the last line
//   shown from that pool kept out of the OPENING draw of the new bag
//   (swapped away from the top of the deck), so there is no repeat
//   across the bag boundary either — and every bag still holds every
//   line exactly once. (Excluding that line from the whole bag instead
//   would shrink each bag to n-1 lines, so a fixed window of n draws
//   could repeat an earlier line; the opening-draw exclusion keeps the
//   same audible guarantee with true full cycles.)
// - A global guard also stops the same string twice in a row across ANY
//   pool (two pools could share a wording; the user never hears a repeat).
// - Bags + last-shown line persist in localStorage ('astolfo-lines-v1'),
//   so a reload does not restart the same first lines. If a pool's line
//   count changed since the stored state was saved, that pool's bag resets.
// - Time routing: next('wake', {hour: 9}) and next('greet', {hour: 20})
//   prefer a time sub-pool (Morning/Afternoon/Evening/Night) when one
//   exists, and fall back to the base pool when it does not.
// - {n} placeholders are stored as-is; the caller replaces them
//   (e.g. line.replace('{n}', Game.toFaDigits(n))).
// - Node-compatible: in Node there is no window/localStorage, so bags
//   live in memory only and Lines is exported via module.exports.
(function () {
  'use strict';

  var STORE_KEY = 'astolfo-lines-v1';

  // ---------------------------------------------------------------- pools
  // Voice: Astolfo — bright, playful, earnest, colloquial Iranian Persian.
  // No emojis in any line, no English in bubble lines (Zzz is fine).
  var POOLS = {
    pet: [
      'یاهو! ناز شدم! بازم، بازم!',
      'هی هی! سرم رو که ناز می‌کنی، دلم قش می‌ره!',
      'آخ! یه کم قلقلکم میاد، ولی ادامه بده!',
      'چه دستای خوبی داری! یه بار دیگه!',
      'وای! موهام به هم ریخت، ولی اشکالی نداره، تو ناز کن!',
      'حس می‌کنم یه قهرمان شدم که تازه تاج گذاری کرده!',
      'نازت خیلی خوبه! یه کم بیشتر، یه کم بیشتر!',
      'هه! گوشم رو هم ناز کن، اونجا خیلی حس خوبیه!',
      'اگه همین‌جوری ادامه بدی، از خوشحالی می‌ترکم!',
      'تو بهترین نوازشگر دنیایی! قول می‌دم!',
      'یه لحظه صبر کن... آخ، چه حسی! دوباره!',
      'سرم زیر دستت انقدر آرومه که دلم می‌خواد همین‌جا بمونم!'
    ],
    poke: [
      'هی! این دیگه ناز کردن نبود، قلقلک بود!',
      'اوچ! مواظب باش، من از جنس شیشه نیستم، ولی نزدیکشم!',
      'بازم بهم سوزن زدی؟ یه بار دیگه و منم تلافی می‌کنم!',
      'هی هی! من یه شوالیه‌م، نه یه بالش برای تست انگشت!',
      'آخ! این دفعه رو می‌بخشم، دفعه‌ی بعد دیگه نه!',
      'چی شد؟ فکر کردی من یه عروسکم؟ خب... شاید یه کم!',
      'اوه! این یه ضربه‌ی محترمانه بود یا غیرمحترمانه؟',
      'بس کن دیگه! دارم غش می‌کنم از بس بهم سوزن می‌زنی!',
      'وای! اگه بازم این کارو بکنی، مجبورم بهت بخندم!',
      'هوم! این انگشتت رو بردار، یا اینکه بیا نازش کن، انتخاب با توئه!'
    ],
    feedSnack: [
      'قچ قچ! این اسنک چه صدایی داره! خوشمزه‌ست!',
      'یه اسنک کوچولو، ولی حالم رو خیلی خوب کرد!',
      'وای! این اسنک ترده و نمکیه، دقیقاً همون چیزی که می‌خواستم!',
      'یه لقمه‌ی دیگه؟ این اسنک انقدر خوبه که نمی‌تونم وایسم!',
      'قچ! قچ! بگو ببینم، تو جادویی که این اسنک رو پیدا کردی؟',
      'اسنک خوردی؟ نه، من خوردم! و عالی بود!'
    ],
    feedMeal: [
      'واه! یه غذای درست و حسابی! شکمم داره شادی می‌کنه!',
      'این غذا بوی بهشت می‌ده! بذار همه‌ش رو بخورم!',
      'یه وعده‌ی کامل! حالا دیگه می‌تونم سه تا ماجراجویی برم!',
      'چقدر خوشمزه‌ست! آشپزت رو تحسین می‌کنم، اونم تویی!',
      'غذا خوردن با تو همیشه بهترین بخش روزه!',
      'شکمم سیر شد، قلبم هم سیر شد! ممنون رفیق!'
    ],
    feedDrink: [
      'قلپ قلپ! چه نوشیدنی خنکی! گلوم تازه شد!',
      'وای! این نوشیدنی انقدر خوبه که دلم می‌خواد یه لیوان دیگه!',
      'هورت کشیدم و همه‌ش رو خوردم! خیلی سرحال شدم!',
      'این نوشیدنی طعم تابستون می‌ده! یه جرعه‌ی دیگه؟',
      'قلپ! چه مزه‌ی خوبی! تو همیشه بهترین نوشیدنی‌ها رو پیدا می‌کنی!',
      'گلوم دیگه خشک نیست، حالا می‌تونم فریاد بزنم یاهو!'
    ],
    feedCake: [
      'وای، کیک! شیرین‌ترین لحظه‌ی روز همینه!',
      'یه گاز کیک و دنیا قشنگ‌تر شد!',
      'این کیک انقدر نرمه که داره تو دهنم آب می‌شه!',
      'کیک! کیک! تو می‌دونی چطور دلم رو شاد کنی!',
      'خامه‌ش رو هم خوردم! یه تیکه‌ی دیگه می‌خوام!',
      'کیک خوردن با تو، مزه‌ش دو برابر می‌شه!'
    ],
    feedTea: [
      'قلپ! مرواریدهای چای حبابی رو گرفتم! چه باحال!',
      'این چای حبابی انقدر باحاله که مرواریداش تو دهنم می‌رقصن!',
      'یه جرعه‌ی دیگه از چای حبابی! مرواریداش رو یکی یکی می‌جوم!',
      'وای! چای حبابی با مروارید! این دیگه یه ماجراجویی تو یه لیوانه!',
      'قلپ قلپ! مروارید آخر رو هم گرفتم! برنده‌ی چای حبابی منم!'
    ],
    feedCookie: [
      'قچ! کوکی ستاره‌ای! حتی شکلش هم بهم میاد!',
      'این کوکی ستاره‌ای انقدر خوشمزه‌ست که دلم می‌خواد یه جعبه‌ی دیگه!',
      'یه گاز از کوکی ستاره‌ای و حس می‌کنم خودم شدم یه ستاره!',
      'کوکی ستاره‌ای رو با یه جرعه‌ی چای... وای، چه ترکیبی!',
      'قچ قچ! کوکی ستاره‌ای منو یاد آسمون شب می‌اندازه!'
    ],
    feedMilk: [
      'قلپ قلپ! شیر توت‌فرنگی انقدر خوشمزه‌ست که سبیل صورتی شدم!',
      'وای! شیر توت‌فرنگی! صورتی و شیرین، دقیقاً مثل خودم!',
      'یه لیوان شیر توت‌فرنگی و حالم مثل بهار شد!',
      'شیر توت‌فرنگی رو تا ته خوردم! ته لیوان هم مزه‌ش مونده!',
      'قلپ! شیر توت‌فرنگی بهترین نوشیدنی دنیاست، قبول داری؟'
    ],
    feedCandy: [
      'قچ! آبنبات ستاره‌ای رو گاز زدم! شیرین و برق‌دار!',
      'وای! آبنبات ستاره‌ای تو دهنم جرقه می‌زنه!',
      'یه آبنبات ستاره‌ای و حس می‌کنم خودم شدم یه ستاره‌ی شیرین!',
      'آبنبات ستاره‌ای رو مکیدم تا آخرش! مزه‌ش مثل آسمون شبه!',
      'قچ قچ! آبنبات ستاره‌ای انقدر خوبه که دلم یه جعبه‌ی دیگه می‌خواد!'
    ],
    feedPudding: [
      'وای! پودینگ لرزید و بعد تو دهنم آب شد! چه باحال!',
      'یه قاشق پودینگ و دنیا یه کم شیرین‌تر شد!',
      'پودینگ! لرزون و شیرین، بهترین دسر دنیا!',
      'پودینگ رو با یه قاشق بزرگ خوردم! ته ظرف رو هم لیس زدم!',
      'یه کاسه پودینگ و من شدم خوشحال‌ترین شوالیه‌ی دنیا!'
    ],
    plushHug: [
      'عروسک خرگوشی رو بغلم کردم! نرم و لطیفه، مثل یه ابر کوچولو!',
      'وای! خرگوشی رو محکم بغل کردم! دلم گرم شد!',
      'این عروسک خرگوشی بهترین دوست بغل‌کردنیه!',
      'بغل خرگوشی! حالا دیگه هیچی نمی‌تونه ناراحتم کنه!'
    ],
    wandWave: [
      'چوبدستی ستاره‌ای رو تکون دادم! جرقه‌ها پخش شدن!',
      'وای! با چوبدستی یه ستاره‌ی کوچولو ساختم!',
      'چوبدستی رو چرخوندم! جادو تو هواست!',
      'یه تکون چوبدستی و همه‌جا برق زد! من یه جادوگرم!'
    ],
    achievement: [
      'یاهو! یه افتخار تازه گرفتم! ببین چی شدم!',
      'وای! یه دستاورد جدید! من دارم بهتر و بهتر می‌شم!',
      'یه افتخار تازه تو کلکسیونم! تو هم دیدیش، نه؟',
      'آفرین به ما! یه افتخار دیگه هم گرفتیم!'
    ],
    bath: [
      'آخیش! چه حبابایی، برق افتادم!',
      'وای! آب گرمه و حبابا دارن دورم می‌رقصن!',
      'حموم کردن با این همه حباب، مثل جشنه!',
      'یه حباب رو سرم نشست! ببین چقدر بامزه‌م!',
      'آب بازی خیلی باحاله! یه کم دیگه آب بریز!',
      'تمیز شدم! حالا بوش رو حس کن، مثل گل بهاره!',
      'حباب، حباب، همه‌جا حباب! بهترین حموم دنیا!',
      'بعد از این حموم، می‌تونم دوباره برم ماجراجویی، تمیز و سرحال!'
    ],
    sleep: [
      'شب بخیر! Zzz',
      'چشمام داره بسته می‌شه... خوابای خوب ببین!',
      'می‌رم بخوابم، فردا با انرژی برمی‌گردم! Zzz',
      'شب بخیر رفیق! تو خوابم هم ماجراجویی می‌کنم!',
      'خسته شدم... یه خواب خوب و عمیق می‌خوام. Zzz',
      'خاموش می‌شم برای یه کم... فردا صبح بیدارم کن!'
    ],
    wake: [
      'یاهو! خواب خوبی بود!',
      'بیدار شدم! آماده‌م برای یه روز پرماجرا!',
      'وای! چه خواب عمیقی! حالا سرحال و قبراقم!',
      'صبح شده؟ بزن بریم، امروز حتماً یه اتفاق خوب می‌افته!',
      'چشمام رو باز کردم و اولین چیزی که دیدم تو بودی! یاهو!',
      'خوابم تموم شد! کی حاضره بره بیرون بازی؟',
      'آخیش! یه کش و قوس حسابی و بعدش شروع می‌کنیم!',
      'بیدار بیدارم! دیشب تو خواب داشتم با یه اژدها دوست می‌شدم!'
    ],
    wakeMorning: [
      'صبح بخیر! آفتاب اومده و منم بیدار شدم!',
      'یاهو! صبح شده! بریم یه صبحانه‌ی حسابی بخوریم!',
      'صبح بخیر رفیق! امروز رو با یه لبخند شروع می‌کنیم!',
      'بیدار شدم و بوی صبح تو هوا پیچیده! چه روز خوبیه!'
    ],
    wakeNight: [
      'این وقت شب بیدارم کردی؟ باشه، ماجراجویی شبانه هم باحاله!',
      'نیمه‌شبه ولی چشمام بازه! بریم یه کم ستاره بشمریم؟',
      'بیدار شدم، ولی ماه هنوز بالاست! شب هنوز تموم نشده!'
    ],
    starStart: [
      'بریم ستاره بگیریم! آماده‌ای؟',
      'یاهو! بازی ستاره‌ها شروع شد! همه‌ش رو می‌گیرم!',
      'چشمام رو به آسمون دوختم! ستاره‌ها، من اومدم!',
      'بزن بریم! هر ستاره یه سکه‌ست!'
    ],
    starWin: [
      'آفرین! {n} تا ستاره گرفتی! تو یه ستاره‌شکار واقعی هستی!',
      'وای! {n} تا ستاره! رکورد زدی، رفیق!',
      '{n} تا ستاره تو جیبمه! حالا می‌تونیم یه چیز خوب بخریم!',
      'چه دستایی! ستاره‌ها خودشون اومدن تو دستت!',
      'باورنکردنیه! این همه ستاره رو از آسمون چیدی!',
      'تو بهترین ستاره‌گیری که دیدم! یه دور دیگه؟'
    ],
    starLow: [
      'فقط چند تا ستاره گرفتی، ولی اشکالی نداره! دفعه‌ی بعد بیشتر می‌گیری!',
      'آخ! ستاره‌ها این دفعه سریع بودن، ولی تو هم سریع‌تر می‌شی!',
      'کم گرفتی، ولی تلاشت رو دیدم! یه دور دیگه بریم؟',
      'ستاره‌های کمی گرفتی، ولی هر ستاره یه قدم به جلوئه!',
      'ناامید نشو! ستاره‌ها منتظرن که برگردی و همه‌شون رو بگیری!'
    ],
    starQuit: [
      'باشه، بعداً دوباره بازی می‌کنیم!',
      'خسته شدی؟ اشکالی نداره، ستاره‌ها صبر می‌کنن!',
      'بازی رو ول کردیم، ولی ماجراجویی تموم نشده!',
      'باشه باشه! یه استراحت کوچولو و بعد برمی‌گردیم!'
    ],
    memoryStart: [
      'بازی حافظه! ببینم حافظه‌ت چقدر قویه!',
      'بریم کارت‌ها رو بچینیم! من همه‌ش رو یادم می‌مونه!',
      'یاهو! بازی حافظه شروع شد! چشمات رو باز نگه دار!'
    ],
    memoryWin: [
      'بردی! حافظه‌ت مثل یه گنجه‌ی پر از جواهره!',
      'وای! همه‌ی جفت‌ها رو پیدا کردی! تو یه نابغه‌ای!',
      'آفرین! حافظه‌ت از من هم بهتره، و این خیلی می‌گه!',
      'چه بازی‌ای! کارت‌ها خودشون بهت احترام گذاشتن!',
      'برنده شدی! یه دور دیگه؟ این دفعه من می‌برم!'
    ],
    timingStart: [
      'بازی زمان‌بندی! دقیقاً همون لحظه بزن!',
      'بریم! زمان‌بندی خوب، نصف برده!',
      'یاهو! آماده‌ی یه ضربه‌ی دقیق باش!'
    ],
    timingWin: [
      'دقیق زدی! زمان‌بندیت عالی بود!',
      'وای! همون لحظه‌ی درست! تو یه استادی!',
      'آفرین! ضربه‌ت مثل ساعت دقیق بود!',
      'چه زمان‌بندی‌ای! من هم تحت تأثیر قرار گرفتم!',
      'بردی! حس زمانت واقعاً حرف نداره!'
    ],
    ballToss: [
      'توپ رو بنداز! من می‌گیرمش!',
      'وای! توپ داره می‌اد! گرفتمش!',
      'توپ بازی خیلی باحاله! یه بار دیگه بنداز!',
      'این توپ رو مثل یه ستاره پرت کن! من آماده‌م!',
      'گرفتم! گرفتم! تو بهترین پرت‌کننده‌ای!'
    ],
    shopBuy: [
      'وای، اینو خریدی! خیلی بهم میاد؟',
      'خرید خوبی بود! حالا شیک‌تر شدم!',
      'یاهو! یه چیز تازه! بذار امتحانش کنم!',
      'ممنون که برام خریدی! تو بهترین رفیقی!',
      'این آیتم رو خیلی دوست دارم! مرسی!',
      'وای! حالا با این خرید، یه قدم به قهرمان شدن نزدیک‌تر شدم!'
    ],
    shopCake: [
      'یه کیک خریدی! از منوی غذا می‌تونی بهم بدی.',
      'کیک خریدی؟ تو می‌دونی چی دوست دارم!',
      'یه کیک تازه! نمی‌تونم صبر کنم بخورمش!',
      'کیک تو کیفمه! بعداً با هم می‌خوریمش!'
    ],
    cantAfford: [
      'سکه‌م کمه! برو ستاره جمع کن یا باهام بازی کن.',
      'اوه! پولم نمی‌رسه! یه کم سکه جمع کنیم بعد برمی‌گردیم!',
      'این یکی گرونه! بذار اول یه کم بازی کنیم و سکه بگیریم!',
      'سکه‌هام تموم شد! ولی ناامید نشو، ستاره‌ها منتظرن!',
      'نمی‌تونم بخرمش، ولی دفعه‌ی بعد حتماً می‌خرمش!'
    ],
    locked: [
      'این آیتم از سطح بالاتر باز می‌شه!',
      'هنوز قفلش باز نشده! یه کم دیگه بازی کن تا باز بشه!',
      'اوه! این یکی برای قهرمان‌های سطح بالاترِ! زود بهش می‌رسیم!',
      'قفله! ولی ما که ناامید نمی‌شیم، نه؟'
    ],
    levelUp: [
      'سطح {n} شدم! جایزه‌ت ۲۰ سکه‌ست!',
      'یاهو! رسیدم به سطح {n}! ما داریم قوی‌تر می‌شیم!',
      'سطح {n}! حالا می‌تونم کارهای باحال‌تری بکنم!',
      'یه سطح بالاتر! تو و من، یه تیم شکست‌ناپذیر!',
      'وای! سطحم بالا رفت! حس می‌کنم بال‌هام دراومده!',
      'سطح {n} شدیم! این ماجراجویی داره بهتر و بهتر می‌شه!'
    ],
    idleHappy: [
      'یاهو! امروز چه روز خوبیه!',
      'بزن بریم یه ماجراجویی!',
      'تو بهترین دوستی!',
      'هوا خوبه، دلم می‌خواد پرواز کنم!',
      'یه چیز ناز بگو ببینم!',
      'هی هی! خوشحالم که اینجایی!',
      'امروز انقدر خوبه که دلم می‌خواد برقصم!',
      'یه آهنگ تو سرمه و نمی‌تونم وایسم!',
      'با تو بودن، بهترین سرگرمی دنیاست!',
      'حس می‌کنم امروز یه اتفاق جادویی می‌افته!'
    ],
    idleHungry: [
      'شکمم داره قار و قور می‌کنه... یه چیزی بده بخورم!',
      'گرسنه‌م! یه اسنک؟ یه غذای درست؟ هرچی!',
      'اگه غذا ندی، موهامو خودم می‌خورم! شوخی کردم... یا نه؟',
      'شکمم داره آهنگ گرسنگی می‌زنه! یه لقمه بده!',
      'بوی غذا میاد؟ یا فقط خیال می‌کنم؟ شکمم داره اعتراض می‌کنه!',
      'گرسنه‌م انقدر که می‌تونم یه کوه کیک بخورم!'
    ],
    idleSleepy: [
      'چشمام داره بسته می‌شه... یه چرت کوچولو؟',
      'خسته‌م... بذار یه کم بخوابم.',
      'خوابم میاد... تو هم بیا بخوابیم؟',
      'پلکام سنگین شده... یه خواب کوتاه، فقط یه خواب کوتاه!',
      'خمیازه... ببخشید! انرژی‌م داره تموم می‌شه!',
      'اگه یه بالش داشتم، همین‌جا می‌خوابیدم!'
    ],
    idleMessy: [
      'اوه... یه کم کثیف شدم. حمومم می‌بری؟',
      'حس می‌کنم نیاز به یه حموم خوب دارم!',
      'کثیفم ولی هنوز نازم، نه؟',
      'یه لکه اینجاست، یه لکه اونجاست... من شدم یه تابلو نقاشی!',
      'موهام به هم ریخته و دستام کثیفه! وقتشه حموم کنم!',
      'کثیف شدن هم بخشی از ماجراجوییه، ولی حموم هم بخشی از اونه!'
    ],
    idleSad: [
      'یه کم دلم گرفته... بغلم کن؟',
      'حوصله‌م سر رفته... باهام بازی می‌کنی؟',
      '...یه کم ناراحتم. نازم کن خوب می‌شم.',
      'امروز یه کم غمگینم... یه حرف خوب بزن ببینم!',
      'دلم می‌خواد یه نفر پیشم باشه... تو هستی، نه؟',
      'ناراحتی‌م مثل یه ابر کوچیکه، با یه ناز رد می‌شه!'
    ],
    idleBored: [
      'حوصله‌م سر رفته! یه بازی بکنیم؟',
      'هیچی برای انجام دادن نیست... یا هست؟ تو بگو!',
      'دارم از بی‌حوصلگی آب می‌شم! نجاتم بده!',
      'یه ماجراجویی کوچولو؟ یه بازی؟ هرچی، فقط یه کاری بکنیم!',
      'خسته شدم از وایسادن! بزن بریم یه جایی!'
    ],
    idleExcited: [
      'یاهو! نمی‌تونم صبر کنم! بریم!',
      'هیجان دارم! امروز حتماً یه چیز باحال پیش میاد!',
      'قلبم داره تند تند می‌زنه! بریم ماجراجویی!',
      'وای! انقدر هیجان‌زده‌م که نمی‌تونم وایسم!',
      'بزن بریم! هیجان تو هواست!'
    ],
    idleSleeping: [
      'Zzz...',
      '...خوابم...',
      'Zzz... خوابای شیرین...',
      '...یه کم دیگه بخوابم...'
    ],
    greet: [
      'یاهو! سلام رفیق! خوشحالم که برگشتی!',
      'سلام! دلم برات تنگ شده بود!',
      'هی! تو اومدی! امروز قراره خیلی باحال باشه!',
      'خوش اومدی! بزن بریم سراغ ماجراجویی امروز!'
    ],
    greetMorning: [
      'صبح بخیر! چه صبح قشنگیه!',
      'یاهو! صبح شده و آفتاب هم سلام می‌کنه!',
      'صبح بخیر رفیق! یه روز تازه، یه ماجراجویی تازه!',
      'بیدار شدی؟ صبح بخیر! بریم صبحانه بخوریم!'
    ],
    greetAfternoon: [
      'ظهر بخیر! آفتاب وسط آسمونه و منم سرحالم!',
      'سلام! ظهر شده، وقتشه یه کاری باحال بکنیم!',
      'ظهر بخیر رفیق! هنوز نصف روز مونده!'
    ],
    greetEvening: [
      'عصر بخیر! غروب قشنگیه، نه؟',
      'سلام! عصر شده و هوا داره خنک می‌شه!',
      'عصر بخیر! بریم یه کم قدم بزنیم؟'
    ],
    greetNight: [
      'شب بخیر! ستاره‌ها اومدن بیرون!',
      'سلام! این وقت شب اومدی؟ ماه رو ببین!',
      'شب بخیر رفیق! شب‌ها هم ماجراجویی دارن!'
    ],
    warnHunger: [
      'هی! شکمم داره خالی می‌شه! یه چیزی بده بخورم!',
      'گرسنگی داره سراغم میاد! یه اسنک کوچولو؟',
      'اوه! اگه غذا نخورم، انرژی‌م تموم می‌شه!',
      'شکمم داره قار و قور می‌کنه، یعنی وقتشه غذا بخورم!'
    ],
    warnEnergy: [
      'خسته شدم... انرژی‌م داره تموم می‌شه!',
      'اوه! پلکام سنگین شده، یه خواب لازم دارم!',
      'انرژی‌م کمه! یه چرت کوچولو حالم رو جا میاره!',
      'حس می‌کنم باتری‌م داره خالی می‌شه! بخوابونم؟'
    ],
    warnClean: [
      'اوه! یه کم کثیف شدم! حموم لازم دارم!',
      'حس می‌کنم به یه حموم خوب نیاز دارم!',
      'کثیفی‌م داره زیاد می‌شه! آب و حباب، لطفاً!',
      'موهام به هم ریخته! یه دوش حسابی می‌خوام!'
    ],
    warnHappy: [
      'یه کم دلم گرفته... باهام بازی کن، خوب می‌شم!',
      'حوصله‌م سر رفته! یه ناز حسابی می‌خوام!',
      'خوشحالی‌م داره کم می‌شه! بیا یه کاری باحال بکنیم!',
      'دلم یه لبخند می‌خواد! تو که بلدی، نه؟'
    ],
    questDone: [
      'مأموریت انجام شد! ما یه تیم فوق‌العاده‌ایم!',
      'یاهو! مأموریت رو کامل کردیم! جایزه مال ماست!',
      'آفرین به ما! یه مأموریت دیگه هم تموم شد!',
      'مأموریت تمومه! حالا چی؟ یه ماجراجویی تازه؟',
      'انجامش دادیم! حس قهرمان بودن خیلی خوبه!'
    ],
    refuseSleep: [
      'Zzz... خوابم... بعداً غذا می‌خورم.',
      'Zzz... خوابم... بذار بخوابم.',
      '...خوابم... بعداً بازی می‌کنیم.'
    ],
    chatFallback: [
      'یاهو! مغزم یه لحظه رفت استراحت، یه بار دیگه بگو ببینم!',
      'اوه! سرم یه کم گیج رفت، ولی برگشتم! دوباره بگو چی گفتی؟',
      'هی هی! یه لحظه هنگ کردم، ولی الان سر حالم! دوباره بگو!',
      'اوه اوه! فکرم یه لحظه رفت پیاده‌روی! برگشت، بگو چی گفتی؟',
      'هی! یه ثانیه مغزم رفت دنبال یه پروانه! برگشتم، دوباره بگو!',
      'اوه! مغزم یه لحظه رفت سراغ یه بستنی! برگشتم، بگو چی می‌خواستی؟',
      'وای! یه لحظه ذهنم رفت تو ابرا! پیداش کردم، بگو ببینم!',
      'هوم! مغزم یه چرت کوچولو زد! بیدار شدم، دوباره بگو چی گفتی؟'
    ]
  };

  // Required minimums (used by _selfTest and the Node self-test).
  var MINIMUMS = {
    pet: 12, poke: 10,
    feedSnack: 6, feedMeal: 6, feedDrink: 6, feedCake: 6, feedTea: 5, feedCookie: 5,
    feedMilk: 5, feedCandy: 5, feedPudding: 5, plushHug: 4, wandWave: 4, achievement: 4,
    bath: 8,
    sleep: 6, wake: 8, wakeMorning: 4, wakeNight: 3,
    starStart: 4, starWin: 6, starLow: 5, starQuit: 4,
    memoryStart: 3, memoryWin: 5,
    timingStart: 3, timingWin: 5,
    ballToss: 5,
    shopBuy: 6, shopCake: 4, cantAfford: 5, locked: 4,
    levelUp: 6,
    idleHappy: 10, idleHungry: 6, idleSleepy: 6, idleMessy: 6, idleSad: 6,
    idleBored: 5, idleExcited: 5, idleSleeping: 4,
    greetMorning: 4, greetAfternoon: 3, greetEvening: 3, greetNight: 3,
    warnHunger: 4, warnEnergy: 4, warnClean: 4, warnHappy: 4,
    questDone: 5, refuseSleep: 3, chatFallback: 8
  };

  var EMOJI_RE = new RegExp('[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F]', 'u');

  // ------------------------------------------------------------ storage
  function storageAvailable() {
    try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; }
  }
  function loadStored() {
    if (!storageAvailable()) return null;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1 || typeof s !== 'object') return null;
      return s;
    } catch (e) { return null; }
  }
  function saveStored(state) {
    if (!storageAvailable()) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function clearStored() {
    if (!storageAvailable()) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ------------------------------------------------------- time routing
  // 5-11 Morning, 12-17 Afternoon, 18-22 Evening, else Night.
  function pickTimePool(base, hour) {
    var h = ((Number(hour) % 24) + 24) % 24;
    var suffix = (h >= 5 && h <= 11) ? 'Morning'
      : (h >= 12 && h <= 17) ? 'Afternoon'
      : (h >= 18 && h <= 22) ? 'Evening' : 'Night';
    var candidate = base + suffix;
    if (POOLS[candidate] && POOLS[candidate].length) return candidate;
    return base;
  }

  // ------------------------------------------------------------- engine
  function makeEngine(persist) {
    var bags = {};        // pool -> remaining indices (shuffled, pop from end)
    var lastPerPool = {}; // pool -> last shown index (for bag-boundary exclusion)
    var lastLine = null;  // last shown string overall (global no-repeat guard)

    if (persist) {
      var stored = loadStored();
      if (stored) {
        if (stored.bags && typeof stored.bags === 'object') bags = stored.bags;
        if (stored.lastPerPool && typeof stored.lastPerPool === 'object') lastPerPool = stored.lastPerPool;
        if (typeof stored.lastLine === 'string') lastLine = stored.lastLine;
        // Stash the counts the stored bags were built from, for validation.
        var storedCounts = (stored.counts && typeof stored.counts === 'object') ? stored.counts : {};
        // A pool whose line count changed since the save gets a fresh bag.
        Object.keys(POOLS).forEach(function (p) {
          if (storedCounts[p] !== undefined && storedCounts[p] !== POOLS[p].length) {
            delete bags[p];
            delete lastPerPool[p];
          }
        });
      }
    }

    function countsSnapshot() {
      var c = {};
      Object.keys(POOLS).forEach(function (p) { c[p] = POOLS[p].length; });
      return c;
    }
    function save() {
      if (!persist) return;
      saveStored({ v: 1, bags: bags, lastPerPool: lastPerPool, lastLine: lastLine, counts: countsSnapshot() });
    }

    // Full shuffled bag of all indices. notFirstIdx (when given) is kept
    // out of the opening draw: bags are popped from the end, so if the
    // excluded index lands on top it is swapped with the bottom card.
    // Every index still appears exactly once in the bag.
    function shuffledBag(pool, notFirstIdx) {
      var idxs = [];
      for (var i = 0; i < POOLS[pool].length; i++) idxs.push(i);
      // Fisher-Yates.
      for (var j = idxs.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var tmp = idxs[j]; idxs[j] = idxs[k]; idxs[k] = tmp;
      }
      if (notFirstIdx !== undefined && notFirstIdx !== null && idxs.length > 1
          && idxs[idxs.length - 1] === notFirstIdx) {
        var t = idxs[0]; idxs[0] = idxs[idxs.length - 1]; idxs[idxs.length - 1] = t;
      }
      return idxs;
    }

    function validBag(pool) {
      var bag = bags[pool];
      if (!Array.isArray(bag)) return false;
      var seen = {};
      for (var i = 0; i < bag.length; i++) {
        var v = bag[i];
        if (typeof v !== 'number' || v < 0 || v >= POOLS[pool].length || seen[v]) return false;
        seen[v] = true;
      }
      return true;
    }

    function next(pool, ctx) {
      var hour;
      if (ctx && typeof ctx.hour === 'number') hour = ctx.hour;
      else if (typeof ctx === 'number') hour = ctx;

      var actual = pool;
      if ((pool === 'wake' || pool === 'greet') && typeof hour === 'number') {
        actual = pickTimePool(pool, hour);
      }
      if (!POOLS[actual] || !POOLS[actual].length) return '';

      var lines = POOLS[actual];

      // A one-line pool cannot avoid a repeat; just return it.
      if (lines.length === 1) {
        lastPerPool[actual] = 0;
        lastLine = lines[0];
        save();
        return lines[0];
      }

      var bag = validBag(actual) ? bags[actual] : shuffledBag(actual, lastPerPool[actual]);
      bags[actual] = bag;
      if (!bag.length) {
        // Bag emptied: reshuffle the FULL pool, with the last line shown
        // from this pool kept out of the opening draw, so the boundary
        // never repeats either.
        bag = shuffledBag(actual, lastPerPool[actual]);
        bags[actual] = bag;
      }

      var idx = bag.pop();

      // Global guard: never the same string twice in a row across ANY pool.
      if (lines[idx] === lastLine) {
        if (bag.length) {
          // Swap with another remaining card; the drawn line goes back at
          // the FRONT of the bag (drawn last in this cycle), never at the
          // end where the next pop would repeat it inside this cycle.
          var alt = bag.pop();
          bag.unshift(idx);
          idx = alt;
        } else {
          // This was the bag's last line and it equals the previous line:
          // reshuffle the full pool with it kept out of the opening draw.
          var fresh = shuffledBag(actual, idx);
          bags[actual] = fresh;
          idx = fresh.pop();
        }
      }

      lastPerPool[actual] = idx;
      lastLine = lines[idx];
      save();
      return lines[idx];
    }

    function count(pool) {
      return (POOLS[pool] && POOLS[pool].length) || 0;
    }
    function counts() {
      var c = {};
      Object.keys(POOLS).forEach(function (p) { c[p] = POOLS[p].length; });
      return c;
    }
    function resetAll() {
      bags = {};
      lastPerPool = {};
      lastLine = null;
      clearStored();
    }

    // Runs the same guarantees as verify/lines-selftest.js, but on an
    // isolated in-memory engine so it never disturbs the live bags.
    // Returns { pass, checks: [{ name, pass, detail }] }.
    function selfTest() {
      var checks = [];
      var eng = makeEngine(false);
      var names = Object.keys(POOLS);
      var i, j, n, cycle, first, prev, ok, detail;

      // (a)+(b) every pool: 3 full cycles, no repeat inside a cycle or
      // across a cycle boundary.
      ok = true; detail = '';
      for (i = 0; i < names.length; i++) {
        n = POOLS[names[i]].length;
        prev = null;
        for (j = 0; j < 3; j++) {
          cycle = [];
          for (var d = 0; d < n; d++) cycle.push(eng.next(names[i]));
          if (new Set(cycle).size !== n) { ok = false; detail = names[i] + ': repeat inside cycle ' + (j + 1); break; }
          if (prev !== null && cycle[0] === prev) { ok = false; detail = names[i] + ': repeat across boundary into cycle ' + (j + 1); break; }
          prev = cycle[cycle.length - 1];
        }
        if (!ok) break;
      }
      checks.push({ name: 'no repeat within any cycle, or across cycle boundaries (3 cycles per pool)', pass: ok, detail: detail || 'all ' + names.length + ' pools x 3 cycles clean' });

      // (c) 200 mixed-pool draws: no identical consecutive lines.
      ok = true; detail = '';
      var last = null;
      for (i = 0; i < 200; i++) {
        var line = eng.next(names[Math.floor(Math.random() * names.length)]);
        if (line === last) { ok = false; detail = 'repeat at draw ' + (i + 1) + ': ' + line; break; }
        last = line;
      }
      checks.push({ name: 'no identical consecutive lines over 200 mixed-pool draws', pass: ok, detail: detail || '200 draws clean' });

      // (d) every pool meets its minimum.
      ok = true; detail = '';
      for (i = 0; i < names.length; i++) {
        var min = MINIMUMS[names[i]] || 0;
        if (POOLS[names[i]].length < min) { ok = false; detail = names[i] + ': ' + POOLS[names[i]].length + ' < min ' + min; break; }
      }
      checks.push({ name: 'every pool meets its minimum count', pass: ok, detail: detail || 'all pools at or above minimum' });

      // (e) no emoji in any line.
      ok = true; detail = '';
      outer: for (i = 0; i < names.length; i++) {
        for (j = 0; j < POOLS[names[i]].length; j++) {
          if (EMOJI_RE.test(POOLS[names[i]][j])) { ok = false; detail = names[i] + '[' + j + ']: ' + POOLS[names[i]][j]; break outer; }
        }
      }
      checks.push({ name: 'no emoji in any line', pass: ok, detail: detail || 'checked all lines' });

      // (f) no duplicate string anywhere (keeps the global guard honest).
      ok = true; detail = '';
      var seenLines = {};
      outer2: for (i = 0; i < names.length; i++) {
        for (j = 0; j < POOLS[names[i]].length; j++) {
          var s = POOLS[names[i]][j];
          if (seenLines[s]) { ok = false; detail = 'duplicate in ' + names[i] + ' and ' + seenLines[s] + ': ' + s; break outer2; }
          seenLines[s] = names[i];
        }
      }
      checks.push({ name: 'no duplicate line string across all pools', pass: ok, detail: detail || 'all lines unique' });

      // (g) time routing.
      var tOk = pickTimePool('wake', 9) === 'wakeMorning'
        && pickTimePool('wake', 14) === 'wake'
        && pickTimePool('wake', 20) === 'wake'
        && pickTimePool('wake', 2) === 'wakeNight'
        && pickTimePool('greet', 8) === 'greetMorning'
        && pickTimePool('greet', 14) === 'greetAfternoon'
        && pickTimePool('greet', 19) === 'greetEvening'
        && pickTimePool('greet', 23) === 'greetNight'
        && eng.next('wake', { hour: 9 }) !== '' && POOLS.wakeMorning.indexOf(eng.next('wake', { hour: 9 })) !== -1;
      checks.push({ name: 'pickTimePool routing (wake/greet, all four day parts + fallback)', pass: tOk, detail: tOk ? 'morning/afternoon/evening/night map correctly; missing sub-pool falls back to base' : 'routing mismatch' });

      // (h) {n} placeholders survive untouched (caller replaces them).
      var starHas = POOLS.starWin.filter(function (l) { return l.indexOf('{n}') !== -1; }).length;
      var lvlHas = POOLS.levelUp.filter(function (l) { return l.indexOf('{n}') !== -1; }).length;
      var pOk = starHas >= 3 && lvlHas >= 3;
      checks.push({ name: '{n} placeholders: starWin >= 3, levelUp >= 3', pass: pOk, detail: 'starWin: ' + starHas + ', levelUp: ' + lvlHas });

      var allPass = checks.every(function (c) { return c.pass; });
      return { pass: allPass, checks: checks };
    }

    return {
      next: next,
      count: count,
      counts: counts,
      pickTimePool: pickTimePool,
      pools: POOLS,
      minimums: MINIMUMS,
      _selfTest: selfTest,
      _resetAll: resetAll
    };
  }

  var Lines = makeEngine(true);

  if (typeof window !== 'undefined') window.Lines = Lines;
  if (typeof module !== 'undefined' && module.exports) module.exports = Lines;
})();
