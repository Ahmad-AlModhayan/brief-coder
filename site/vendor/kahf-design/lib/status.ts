// Every state in the Kahf family: tone + icon + label (en, ar). From the Kahf design system.
export type Tone = "neutral" | "solid" | "accent" | "positive" | "info" | "warm" | "attention" | "critical";
export const STATUS: Record<string, Record<string, { tone: Tone; icon: string; en: string; ar: string; progress?: boolean }>> = {
 "sync": {
  "synced": {
   "tone": "positive",
   "icon": "cloud_done",
   "en": "Synced",
   "ar": "متزامن"
  },
  "syncing": {
   "tone": "info",
   "icon": "sync",
   "en": "Syncing",
   "ar": "جارٍ المزامنة"
  },
  "offline": {
   "tone": "neutral",
   "icon": "cloud_off",
   "en": "Offline · saved on this phone",
   "ar": "دون اتصال · محفوظ على هاتفك"
  },
  "conflict": {
   "tone": "attention",
   "icon": "sync_problem",
   "en": "Needs review",
   "ar": "يحتاج مراجعة"
  },
  "failed": {
   "tone": "critical",
   "icon": "error",
   "en": "Sync failed",
   "ar": "تعذّرت المزامنة"
  }
 },
 "download": {
  "none": {
   "tone": "neutral",
   "icon": "download",
   "en": "Not downloaded",
   "ar": "غير محمَّل"
  },
  "downloading": {
   "tone": "info",
   "icon": "downloading",
   "en": "Downloading",
   "ar": "جارٍ التحميل",
   "progress": true
  },
  "ready": {
   "tone": "positive",
   "icon": "check_circle",
   "en": "Ready offline",
   "ar": "جاهز دون اتصال"
  },
  "failed": {
   "tone": "critical",
   "icon": "error",
   "en": "Download failed",
   "ar": "تعذّر التحميل"
  }
 },
 "permission": {
  "granted": {
   "tone": "positive",
   "icon": "check_circle",
   "en": "Allowed",
   "ar": "مسموح"
  },
  "needed": {
   "tone": "attention",
   "icon": "lock",
   "en": "Permission needed",
   "ar": "يلزم إذن"
  },
  "blocked": {
   "tone": "critical",
   "icon": "block",
   "en": "Blocked in settings",
   "ar": "محظور في الإعدادات"
  }
 },
 "ai": {
  "thinking": {
   "tone": "info",
   "icon": "progress_activity",
   "en": "Thinking",
   "ar": "يفكّر"
  },
  "writing": {
   "tone": "accent",
   "icon": "edit",
   "en": "Writing",
   "ar": "يكتب"
  },
  "fallback": {
   "tone": "attention",
   "icon": "route",
   "en": "Answered by the backup model",
   "ar": "أجاب النموذج الاحتياطي"
  },
  "failed": {
   "tone": "critical",
   "icon": "error",
   "en": "No reply · try again",
   "ar": "لم يصل الرد · أعد المحاولة"
  }
 },
 "task": {
  "upcoming": {
   "tone": "neutral",
   "icon": "radio_button_unchecked",
   "en": "Upcoming",
   "ar": "قادم"
  },
  "now": {
   "tone": "solid",
   "icon": "timelapse",
   "en": "Now",
   "ar": "الآن"
  },
  "done": {
   "tone": "positive",
   "icon": "task_alt",
   "en": "Done",
   "ar": "تم"
  },
  "behind": {
   "tone": "attention",
   "icon": "hourglass_bottom",
   "en": "Behind plan",
   "ar": "خلف الخطة"
  },
  "carried": {
   "tone": "warm",
   "icon": "history",
   "en": "Carried over",
   "ar": "مُرحَّل"
  }
 },
 "release": {
  "live": {
   "tone": "positive",
   "icon": "check_circle",
   "en": "Live",
   "ar": "متاح"
  },
  "beta": {
   "tone": "accent",
   "icon": "science",
   "en": "Beta",
   "ar": "تجريبي"
  },
  "building": {
   "tone": "warm",
   "icon": "schedule",
   "en": "In development",
   "ar": "قيد التطوير"
  },
  "open": {
   "tone": "neutral",
   "icon": "code",
   "en": "Open source",
   "ar": "مفتوح المصدر"
  }
 }
};
