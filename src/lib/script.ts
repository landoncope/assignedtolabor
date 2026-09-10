// Script builder content for the quick-upload flow. Carried over from the prototype
// with light edits. Keep this the single source of truth; the review UI shows the
// assembled script next to the video.

export const HOOKS: string[] = [
  "This changed everything for me.",
  "Something happened this week that I can't stop thinking about.",
  "If you're carrying something heavy right now, this is for you.",
  "I didn't see this coming.",
];

export type TemplatePart = { text: string } | { blank: number; placeholder: string };

export type Template = { key: string; label: string; parts: TemplatePart[] };

export const TEMPLATES: Template[] = [
  {
    key: "testimony",
    label: "Testimony",
    parts: [
      { text: "This week, I experienced " },
      { blank: 0, placeholder: "a moment or answered prayer" },
      { text: ". It helped me gain a deeper testimony that " },
      { blank: 1, placeholder: "what you now believe" },
      { text: "." },
    ],
  },
  {
    key: "hope",
    label: "Hope",
    parts: [
      { text: "I have hope in " },
      { blank: 0, placeholder: "what gives you hope" },
      { text: " because " },
      { blank: 1, placeholder: "the reason" },
      { text: "." },
    ],
  },
  {
    key: "faith",
    label: "Faith",
    parts: [
      { text: "I have faith in " },
      { blank: 0, placeholder: "what you have faith in" },
      { text: " because " },
      { blank: 1, placeholder: "the reason" },
      { text: "." },
    ],
  },
];

export const CTAS: string[] = [
  "If you want to learn more, come and see.",
  "If you want to experience this for yourself, come and learn with us.",
  "If you're wondering what faith like this could mean for you, come and study with us.",
  "Follow along, and come and see where this leads.",
];

export const CONSENT: string[] = [
  "Strangers around the world will see this video and connect you with Jesus Christ and His Church.",
  "You'll share a sincere expression of hope or faith that represents you, your family, and the Church well.",
];

export const RECORDING_TIPS = ["Take a deep breath.", "Be yourself!", "Don't forget to smile!"];

export function fillTemplate(t: Template, blanks: string[]): string {
  return t.parts
    .map((p) => ("text" in p ? p.text : blanks[p.blank]?.trim() || `[${p.placeholder}]`))
    .join("");
}
