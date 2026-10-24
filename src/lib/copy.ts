// English is the only reviewed interface language. Keep shared product language here.
// Add a reviewed locale dictionary before offering another language in the interface.
export const en = {
  brand: "Reach",
  tagline: "A little more within reach.",
  statuses: {
    fits: "Fits your stated constraints.",
    confirm: "Needs confirmation.",
    no: "Does not fit this trip.",
  },
  demoNotice:
    "Example mode · Places, schedules, and walking connections below are fictional. Do not use them to travel.",
  scheduleNotice:
    "Scheduled estimates, not live arrivals. Food availability and wait times can change.",
  saveNotice: "Saved on this device. This does not reserve an appointment.",
  sourceNotice:
    "Local pantry listings and a limited BTD feed are reviewed. Conflicting schedules and unreviewed walking links prevent a travel-ready pantry itinerary.",
} as const;
