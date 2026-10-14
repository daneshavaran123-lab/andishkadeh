/**
 * Initial catalogue (PRD §8, §9 and appendix C).
 * Rule from the PRD: tariffs that are not in the approved lists are NOT invented —
 * such services are created inactive with price = null and must be completed from the admin panel.
 */

export interface SeedService {
  code: string;
  title: string;
  unit: string;
  price: number | null;
  description?: string;
  includes?: string[];
}

export interface SeedSubcategory {
  code: string;
  title: string;
  description?: string;
  services: SeedService[];
}

export interface SeedCategory {
  code: string;
  title: string;
  subtitle: string;
  description: string;
  theme: 'blue' | 'red' | 'purple' | 'cyan';
  image: string;
  salesEnabled: boolean;
  subcategories: SeedSubcategory[];
}

const PENDING = 'عنوان و تعرفه این خدمت باید از فهرست تأییدشده مرکز تکمیل شود.';

/** Placeholder services for codes whose title/tariff were not provided (inactive, no price). */
function pending(prefix: string, from: number, to: number, known: Record<number, SeedService>): SeedService[] {
  const list: SeedService[] = [];
  for (let n = from; n <= to; n++) {
    const code = `${prefix}-${n}`;
    list.push(known[n] ?? { code, title: `خدمت ${code} (نیازمند تکمیل)`, unit: 'نفر', price: null, description: PENDING });
  }
  return list;
}

const s = (code: string, title: string, unit: string, price: number, description?: string): SeedService => ({
  code,
  title,
  unit,
  price,
  description,
});

export const CATEGORIES: SeedCategory[] = [
  {
    code: 'P',
    title: 'مرکز سنجش',
    subtitle: 'ارزیابی علمی، عملکرد ورزشی',
    description: 'سنجش ترکیب بدن، آمادگی هوازی و بی‌هوازی، قدرت، توان، سرعت، چابکی و تعادل ورزشکار.',
    theme: 'blue',
    image: 'performance.jpg',
    salesEnabled: true,
    subcategories: [
      {
        code: 'P-1',
        title: 'سلامت و ترکیب بدن',
        services: pending('P', 101, 103, {
          101: s('P-101', 'ارزیابی پایه سلامت', 'نفر', 700_000),
          102: s('P-102', 'InBody', 'نفر', 1_200_000, 'آنالیز ترکیب بدن با دستگاه InBody.'),
        }),
      },
      {
        code: 'P-2',
        title: 'آمادگی هوازی',
        services: pending('P', 201, 206, {
          201: s('P-201', 'VO₂max تردمیل', 'نفر', 3_000_000),
          206: s('P-206', 'پروفایل کامل هوازی', 'نفر', 5_500_000),
        }),
      },
      { code: 'P-3', title: 'آمادگی بی‌هوازی', services: pending('P', 301, 303, {}) },
      {
        code: 'P-4',
        title: 'قدرت',
        services: pending('P', 401, 406, { 406: s('P-406', 'پروفایل کامل قدرت', 'نفر', 4_500_000) }),
      },
      { code: 'P-5', title: 'توان انفجاری', services: pending('P', 501, 505, {}) },
      { code: 'P-6', title: 'سرعت و چابکی', services: pending('P', 601, 605, {}) },
      { code: 'P-7', title: 'تعادل و انعطاف', services: pending('P', 701, 705, {}) },
      {
        code: 'P-8',
        title: 'گزارش تخصصی',
        services: [s('P-801', 'گزارش تحلیلی تخصصی', 'گزارش', 1_500_000)],
      },
    ],
  },
  {
    code: 'N',
    title: 'مرکز تغذیه و متابولیسم',
    subtitle: 'تغذیه سالم، برنامه‌سازی بهتر',
    description: 'ارزیابی، مشاوره، برنامه غذایی، مکمل‌یاری و پایش تغذیه‌ای ورزشکار و تیم.',
    theme: 'red',
    image: 'nutrition.jpg',
    salesEnabled: true,
    subcategories: [
      {
        code: 'N-1',
        title: 'ارزیابی تغذیه',
        services: [
          s('N-101', 'ارزیابی اولیه تغذیه و سبک زندگی ورزشکار', 'نفر', 1_000_000),
          s('N-102', 'ارزیابی ترکیب بدن و تفسیر تغذیه‌ای', 'نفر', 1_500_000),
          s('N-103', 'ارزیابی کامل تغذیه ورزشی + ترکیب بدن + گزارش', 'نفر', 2_500_000),
          s('N-104', 'ارزیابی وضعیت آب‌رسانی و هیدراتاسیون', 'نفر', 800_000),
          s('N-105', 'بررسی عادات غذایی و ثبت/تحلیل رژیم غذایی', 'نفر', 1_000_000),
        ],
      },
      {
        code: 'N-2',
        title: 'مشاوره تغذیه',
        services: [
          s('N-201', 'مشاوره تخصصی تغذیه ورزشی', 'جلسه', 1_000_000),
          s('N-202', 'مشاوره تغذیه تخصصی کشتی‌گیران', 'جلسه', 1_500_000),
          s('N-203', 'مشاوره تغذیه قبل، حین و بعد از تمرین/مسابقه', 'جلسه', 1_500_000),
          s('N-204', 'مشاوره مدیریت وزن و وزن‌کشی مسابقات', 'جلسه', 1_500_000),
          s('N-205', 'مشاوره تغذیه دوره ریکاوری و آسیب', 'جلسه', 1_500_000),
        ],
      },
      {
        code: 'N-3',
        title: 'برنامه غذایی',
        services: [
          s('N-301', 'طراحی برنامه غذایی فردی ورزشکار', 'برنامه', 2_500_000),
          s('N-302', 'طراحی برنامه غذایی اختصاصی کشتی‌گیر', 'برنامه', 3_000_000),
          s('N-303', 'برنامه غذایی دوره آماده‌سازی عمومی (GPP)', 'برنامه', 3_000_000),
          s('N-304', 'برنامه غذایی دوره آماده‌سازی اختصاصی (SPP)', 'برنامه', 3_000_000),
          s('N-305', 'برنامه غذایی دوره مسابقه و ریکاوری', 'برنامه', 3_000_000),
          s('N-306', 'برنامه تخصصی کاهش/افزایش وزن کنترل‌شده', 'برنامه', 3_500_000),
        ],
      },
      {
        code: 'N-4',
        title: 'مکمل‌یاری',
        services: [
          s('N-401', 'ارزیابی و تنظیم مصرف مکمل‌های ورزشی', 'نفر', 1_500_000),
          s('N-402', 'بررسی تداخل مکمل‌ها با برنامه غذایی و تمرینی', 'نفر', 1_500_000),
          s('N-403', 'طراحی پروتکل مکمل‌یاری متناسب با مرحله تمرین', 'پروتکل', 2_000_000),
        ],
      },
      {
        code: 'N-5',
        title: 'پایش تغذیه',
        services: [
          s('N-501', 'پایش ماهانه وضعیت تغذیه ورزشکار', 'نفر/ماه', 2_000_000),
          s('N-502', 'پایش وزن، ترکیب بدن و دریافت غذایی', 'نفر/ماه', 2_500_000),
          s('N-503', 'پایش تغذیه + عملکرد + ریکاوری', 'نفر/ماه', 3_500_000),
          s('N-504', 'پایش کامل تغذیه‌ای کشتی‌گیر از اردو تا مسابقه', 'نفر/ماه', 4_000_000),
        ],
      },
      {
        code: 'N-6',
        title: 'پروفایل تغذیه‌ای',
        services: [
          s('N-601', 'پروفایل کامل تغذیه ورزشی', 'نفر', 5_000_000),
          s('N-602', 'پروفایل تغذیه + ترکیب بدن + هیدراتاسیون + مکمل', 'نفر', 6_000_000),
          s('N-603', 'پروفایل جامع تغذیه‌ای کشتی‌گیر + برنامه فردی', 'نفر', 7_000_000),
        ],
      },
      {
        code: 'N-7',
        title: 'تیم و اردو',
        services: [
          s('N-701', 'طراحی برنامه تغذیه تیمی برای اردو', 'تیم/اردو', 15_000_000),
          s('N-702', 'پایش و مدیریت تغذیه تیم در اردو', 'تیم/روز', 5_000_000),
          s('N-703', 'طراحی پروتکل تغذیه مسابقات برای تیم', 'تیم', 20_000_000),
          s('N-704', 'ارزیابی و گزارش تغذیه‌ای تیم ملی/تیم حرفه‌ای', 'تیم', 25_000_000),
        ],
      },
      {
        code: 'N-8',
        title: 'گزارش تغذیه',
        services: [
          s('N-801', 'گزارش تحلیلی تخصصی تغذیه ورزشکار', 'گزارش', 2_000_000),
          s('N-802', 'گزارش جامع تغذیه، ترکیب بدن و عملکرد', 'گزارش', 4_000_000),
        ],
      },
    ],
  },
  {
    code: 'PS',
    title: 'مرکز روانشناختی',
    subtitle: 'ذهن قوی، عملکرد پایدار',
    description:
      'ارزیابی و آموزش مهارت‌های ذهنی، شناختی و نوروفیزیولوژیک برای ارتقای عملکرد ورزشی. این خدمات جنبه آموزشی و ارتقای عملکرد دارند و ادعای درمان ندارند.',
    theme: 'purple',
    image: 'psychology.jpg',
    salesEnabled: true,
    subcategories: [
      {
        code: 'PS-1',
        title: 'ارزیابی روان‌شناختی',
        services: [
          s('PS-101', 'غربالگری اولیه روان‌شناختی ورزشکار', 'نفر', 1_000_000),
          s('PS-102', 'ارزیابی جامع روان‌شناختی ورزشکار', 'نفر', 2_500_000),
          s('PS-103', 'پروفایل جامع روان‌شناختی و عملکردی ورزشکار', 'نفر', 4_000_000),
          s('PS-104', 'ارزیابی استرس، اضطراب و فشار رقابتی', 'نفر', 1_500_000),
          s('PS-105', 'ارزیابی خلق، انگیزش و آمادگی روانی', 'نفر', 1_500_000),
          s('PS-106', 'ارزیابی تمرکز و توجه', 'نفر', 1_500_000),
          s('PS-107', 'ارزیابی اعتمادبه‌نفس و خودکارآمدی ورزشی', 'نفر', 1_000_000),
          s('PS-108', 'ارزیابی مهارت‌های روانی ورزشی', 'نفر', 2_000_000),
          s('PS-109', 'ارزیابی خواب و کیفیت خواب ورزشکار', 'نفر', 1_000_000),
          s('PS-110', 'ارزیابی فرسودگی و خستگی روانی', 'نفر', 1_500_000),
        ],
      },
      {
        code: 'PS-2',
        title: 'مشاوره و مداخله',
        services: [
          s('PS-201', 'مشاوره روان‌شناسی ورزشی', 'جلسه', 1_000_000),
          s('PS-202', 'مشاوره تخصصی عملکرد ورزشی', 'جلسه', 1_500_000),
          s('PS-203', 'مشاوره مدیریت استرس و اضطراب مسابقه', 'جلسه', 1_500_000),
          s('PS-204', 'مداخله افزایش تمرکز و توجه', 'جلسه', 1_500_000),
          s('PS-205', 'مداخله افزایش اعتمادبه‌نفس و خودکارآمدی', 'جلسه', 1_500_000),
          s('PS-206', 'آموزش مهارت‌های ذهنی ورزشکار', 'جلسه', 1_500_000),
          s('PS-207', 'آمادگی روانی پیش از مسابقه', 'جلسه', 1_500_000),
          s('PS-208', 'مداخله روان‌شناختی پس از شکست/افت عملکرد', 'جلسه', 1_500_000),
          s('PS-209', 'مداخله روان‌شناختی بازگشت به ورزش پس از آسیب', 'جلسه', 1_500_000),
          s('PS-210', 'مشاوره روان‌شناسی مدیریت وزن و فشار وزن‌کشی', 'جلسه', 1_500_000),
        ],
      },
      {
        code: 'PS-3',
        title: 'ارزیابی و تمرین شناختی',
        services: [
          s('PS-301', 'ارزیابی عملکرد شناختی', 'نفر', 2_000_000),
          s('PS-302', 'ارزیابی توجه پایدار و انتخابی', 'نفر', 1_500_000),
          s('PS-303', 'ارزیابی سرعت پردازش اطلاعات', 'نفر', 1_500_000),
          s('PS-304', 'ارزیابی حافظه کاری', 'نفر', 1_500_000),
          s('PS-305', 'ارزیابی کنترل مهاری و عملکرد اجرایی', 'نفر', 1_500_000),
          s('PS-306', 'پروفایل جامع شناختی ورزشکار', 'نفر', 3_500_000),
          s('PS-307', 'تمرین و ارتقای عملکرد شناختی', 'جلسه', 1_500_000),
        ],
      },
      {
        code: 'NE',
        title: 'QEEG و نوروفیزیولوژی',
        services: [
          s('NE-101', 'ثبت EEG', 'نفر', 2_000_000),
          s('NE-102', 'QEEG و تحلیل کمی امواج مغزی', 'نفر', 4_000_000),
          s('NE-103', 'QEEG + گزارش تخصصی عملکرد شناختی', 'نفر', 5_000_000),
          s('NE-104', 'QEEG + پروفایل روان‌شناختی و عملکردی', 'نفر', 6_500_000),
          s('NE-105', 'ارزیابی قبل و بعد از مداخله نوروفیدبک', 'پروتکل', 3_000_000),
        ],
      },
      {
        code: 'NF',
        title: 'نوروفیدبک',
        services: [
          s('NF-101', 'جلسه نوروفیدبک', 'جلسه', 1_500_000),
          s('NF-102', 'پروتکل نوروفیدبک اختصاصی ورزشکار', 'پروتکل', 3_000_000),
          s('NF-103', 'دوره ۱۰ جلسه‌ای نوروفیدبک', 'دوره', 13_500_000),
          s('NF-104', 'دوره ۲۰ جلسه‌ای نوروفیدبک', 'دوره', 25_000_000),
          s('NF-105', 'ارزیابی اثربخشی دوره نوروفیدبک', 'نفر', 3_000_000),
        ],
      },
      {
        code: 'BF',
        title: 'بایوفیدبک',
        services: [
          s('BF-101', 'جلسه بایوفیدبک', 'جلسه', 1_200_000),
          s('BF-102', 'HRV Biofeedback', 'جلسه', 1_200_000),
          s('BF-103', 'آموزش کنترل تنفس و تنظیم برانگیختگی', 'جلسه', 1_000_000),
          s('BF-104', 'پروتکل بایوفیدبک اختصاصی ورزشکار', 'پروتکل', 2_500_000),
          s('BF-105', 'دوره ۱۰ جلسه‌ای بایوفیدبک', 'دوره', 10_000_000),
        ],
      },
      {
        code: 'NS',
        title: 'تحریک مغزی (tDCS)',
        services: [
          s('NS-101', 'ارزیابی و تعیین پروتکل تحریک مغزی', 'نفر', 2_000_000),
          s('NS-102', 'جلسه tDCS تحت نظارت متخصص', 'جلسه', 1_500_000),
          s('NS-103', 'پروتکل ۱۰ جلسه‌ای tDCS', 'دوره', 13_500_000),
          s('NS-104', 'ارزیابی قبل و بعد از tDCS', 'پروتکل', 3_000_000),
        ],
      },
      {
        code: 'VR',
        title: 'واقعیت مجازی (VR)',
        services: [
          s('VR-101', 'ارزیابی روان‌شناختی با VR', 'نفر', 2_000_000),
          s('VR-102', 'تمرین مواجهه با فشار مسابقه', 'جلسه', 1_500_000),
          s('VR-103', 'شبیه‌سازی شرایط مسابقه', 'جلسه', 2_000_000),
          s('VR-104', 'تمرین تمرکز و توجه با VR', 'جلسه', 1_500_000),
          s('VR-105', 'تمرین کنترل اضطراب رقابتی با VR', 'جلسه', 1_500_000),
          s('VR-106', 'پروتکل اختصاصی VR برای ورزشکار', 'پروتکل', 3_000_000),
          s('VR-107', 'دوره ۱۰ جلسه‌ای مداخله VR', 'دوره', 15_000_000),
        ],
      },
      {
        code: 'PS-4',
        title: 'خدمات تیمی',
        services: [
          s('PS-401', 'ارزیابی روان‌شناختی تیم', 'تیم', 10_000_000),
          s('PS-402', 'ارزیابی انسجام تیمی و روابط گروهی', 'تیم', 8_000_000),
          s('PS-403', 'کارگاه آمادگی روانی تیم', 'جلسه', 8_000_000),
          s('PS-404', 'روان‌شناسی مسابقه برای تیم', 'جلسه', 8_000_000),
          s('PS-405', 'همراهی روان‌شناس در اردو', 'روز', 5_000_000),
          s('PS-406', 'برنامه جامع روان‌شناسی تیم در اردو', 'اردو', 25_000_000),
          s('PS-407', 'گزارش تحلیلی روان‌شناختی تیم', 'گزارش', 10_000_000),
        ],
      },
      {
        code: 'PS-5',
        title: 'بسته‌های جامع',
        services: [
          { ...s('PS-501', 'پروفایل روان‌شناختی پایه', 'بسته', 3_500_000), includes: ['غربالگری', 'مشاوره', 'گزارش'] },
          { ...s('PS-502', 'پروفایل عملکرد ذهنی', 'بسته', 5_000_000), includes: ['ارزیابی روان‌شناختی', 'ارزیابی شناختی', 'توجه و تمرکز'] },
          { ...s('PS-503', 'پروفایل نوروفیزیولوژیک', 'بسته', 7_000_000), includes: ['QEEG', 'ارزیابی شناختی', 'گزارش'] },
          { ...s('PS-504', 'پروفایل جامع عملکرد ذهنی', 'بسته', 9_000_000), includes: ['ارزیابی روان‌شناختی', 'ارزیابی شناختی', 'QEEG', 'گزارش'] },
          { ...s('PS-505', 'برنامه جامع آمادگی ذهنی مسابقه', 'بسته', 8_000_000), includes: ['ارزیابی', 'برنامه مداخله', 'پایش'] },
          { ...s('PS-506', 'برنامه جامع عملکرد ذهنی کشتی‌گیر', 'بسته', 15_000_000), includes: ['ارزیابی', 'QEEG', 'NF/BF/VR', 'مشاوره و پایش'] },
        ],
      },
    ],
  },
  {
    code: 'M',
    title: 'مرکز مانیتورینگ',
    subtitle: 'پایش مستمر، تصمیم دقیق',
    description:
      'پایش مستمر شاخص‌های عملکرد، بار تمرین و ریکاوری ورزشکار. در نسخه پایه، ماژول‌های مانیتورینگ به‌عنوان بخشی از اشتراک کامل ارائه می‌شوند.',
    theme: 'cyan',
    image: 'monitoring.jpg',
    salesEnabled: false,
    subcategories: [
      {
        code: 'M-0',
        title: 'ماژول‌های مانیتورینگ',
        services: Array.from({ length: 10 }, (_, i) => {
          const code = `M-${String(i + 1).padStart(2, '0')}`;
          return { code, title: `ماژول مانیتورینگ ${code} (نیازمند تکمیل)`, unit: 'ماه', price: null, description: PENDING };
        }),
      },
    ],
  },
];

export const PLANS = [
  { code: 'SUB-1M', title: 'اشتراک ۱ ماهه', durationMonths: 1, durationDays: 30, price: 4_500_000, badge: null, sortOrder: 1 },
  { code: 'SUB-3M', title: 'اشتراک ۳ ماهه', durationMonths: 3, durationDays: 90, price: 12_800_000, badge: 'پرطرفدار', sortOrder: 2 },
  { code: 'SUB-6M', title: 'اشتراک ۶ ماهه', durationMonths: 6, durationDays: 180, price: 24_300_000, badge: null, sortOrder: 3 },
  { code: 'SUB-12M', title: 'اشتراک ۱۲ ماهه', durationMonths: 12, durationDays: 365, price: 43_200_000, badge: 'به‌صرفه‌ترین', sortOrder: 4 },
];

export const DEFAULT_SETTINGS = {
  centerName: 'اندیشکده کشتی ایران',
  centerSubtitle: 'سنجش، تغذیه، روانشناختی و مانیتورینگ',
  logoMediaId: null as string | null,
  receiptHeader: 'رسید فروش خدمات',
  receiptFooter: 'این رسید صرفاً رسید فروش است و نوبت یا زمان مراجعه را تعیین نمی‌کند.',
  supportText: 'در صورت نیاز به راهنمایی به پذیرش مراجعه کنید.',
  sessionTimeoutSec: 90,
  timeoutWarningSec: 15,
  endScreenSec: 8,
  paymentTimeoutSec: 120,
  maxItemQuantity: 5,
  discountPolicy: 'BEST' as const,
  renewalPolicy: 'EXTEND_FROM_END' as const,
  offlineQrValidation: true,
  offlineSalesEnabled: true,
  offlineSubscriptionSales: false,
  offlineCatalogMaxAgeHours: 72,
  timezone: 'Asia/Tehran',
};

export const DEFAULT_CONTENT = {
  welcome: {
    title: 'اندیشکده کشتی ایران',
    subtitle: 'سنجش، تغذیه، روانشناختی و مانیتورینگ ورزشکار',
    ctaLabel: 'شروع',
    heroMediaId: null as string | null,
  },
  home: {
    title: 'چه کاری می‌خواهید انجام دهید؟',
    servicesTitle: 'خرید خدمات',
    servicesSubtitle: 'انتخاب یک یا چند خدمت از حوزه‌های مختلف و پرداخت یکجا',
    subscriptionTitle: 'خرید اشتراک کامل',
    subscriptionSubtitle: 'دسترسی کامل به حوزه‌های تحت پوشش در مدت اعتبار',
    memberTitle: 'ورود اعضا با QR',
    memberSubtitle: 'بررسی اعتبار اشتراک با اسکن کد QR',
    servicesMediaId: null as string | null,
    subscriptionMediaId: null as string | null,
    memberMediaId: null as string | null,
  },
  subscriptionIntro: {
    title: 'اشتراک کامل اندیشکده',
    subtitle: 'یک اشتراک، دسترسی به همه حوزه‌های تحت پوشش',
    benefits: [
      'دسترسی کامل به خدمات حوزه‌های تحت پوشش در مدت اعتبار',
      'کارت عضویت QR برای بررسی اعتبار در کیوسک',
      'پلن‌های ۱، ۳، ۶ و ۱۲ ماهه',
      'تمدید پیش از پایان اعتبار، از انتهای اعتبار فعلی',
    ],
  },
  monitoringIntro: {
    title: 'مرکز مانیتورینگ',
    body: 'پایش مستمر شاخص‌های عملکرد، بار تمرین و ریکاوری ورزشکار. در نسخه فعلی، ماژول‌های مانیتورینگ به‌عنوان بخشی از اشتراک کامل ارائه می‌شوند و فروش جداگانه ندارند.',
    // Module titles (M-01..M-10) are not in the approved lists yet; fill them from the admin panel.
    modules: [] as string[],
  },
};

/** Photos behind the three home cards (K02), cropped from the approved mockups. */
export const HOME_CARD_IMAGES = {
  servicesMediaId: 'home-services.jpg',
  subscriptionMediaId: 'home-subscription.jpg',
  memberMediaId: 'home-member.jpg',
} as const;

/**
 * Per-service thumbnails (assets/seed-media/services/<file>), cropped from the approved mockups.
 * Services without one show their domain image; every image can be replaced in the admin panel.
 */
export const SERVICE_IMAGES: Record<string, string> = {
  'P-101': 'services/P-101.jpg',
  'P-102': 'services/P-102.jpg',
  'P-201': 'services/P-201.jpg',
  'P-406': 'services/P-406.jpg',
  'PS-101': 'services/PS-101.jpg',
  'PS-102': 'services/PS-102.jpg',
  'PS-103': 'services/PS-103.jpg',
  'PS-104': 'services/PS-104.jpg',
  'PS-105': 'services/PS-105.jpg',
  'PS-106': 'services/PS-106.jpg',
  'PS-201': 'services/PS-201.jpg',
  'PS-301': 'services/PS-301.jpg',
  'PS-401': 'services/PS-401.jpg',
};
