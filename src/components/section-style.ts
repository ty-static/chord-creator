// One colour per section letter, shared by the form chips and the timeline.
const COLORS = [
  {
    chip: "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20",
    letter: "bg-sky-500 text-white",
    band: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  },
  {
    chip: "border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20",
    letter: "bg-violet-500 text-white",
    band: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  },
  {
    chip: "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20",
    letter: "bg-amber-500 text-white",
    band: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  },
  {
    chip: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20",
    letter: "bg-emerald-500 text-white",
    band: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  },
  {
    chip: "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20",
    letter: "bg-rose-500 text-white",
    band: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
  },
  {
    chip: "border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20",
    letter: "bg-cyan-600 text-white",
    band: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-200",
  },
  {
    chip: "border-lime-500/40 bg-lime-500/10 hover:bg-lime-500/20",
    letter: "bg-lime-600 text-white",
    band: "bg-lime-500/15 text-lime-800 dark:text-lime-200",
  },
  {
    chip: "border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20",
    letter: "bg-fuchsia-500 text-white",
    band: "bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-200",
  },
]

export const sectionColor = (index: number) =>
  COLORS[((index % COLORS.length) + COLORS.length) % COLORS.length]
