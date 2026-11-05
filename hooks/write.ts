import type { EngineInterface } from 'claude-code'

// The files the mod keeps: one writer per file, from the newest content.

/** One file of one part in this session: whether a write is in flight, whether one is owed, whether
 * `<dir>/.gitignore` is left alone (a folder not of the mod's own name) or was written, and the newest content to write. */
export type Out = { writing: boolean; owed: boolean; ignore: boolean; ignored: boolean; newest: { name: string; text: () => string } | null }
export const out = (own: boolean): Out => ({ writing: false, owed: false, ignore: !own, ignored: false, newest: null })

/** One write at a time per file, always from the newest content. Two events can wait at once (on
 * `$.session.id()` or on a write); if the earlier one's write landed last, its older figures would sit on
 * top of the newer ones. An event that finds a write in flight marks the file as owed and goes on; the
 * writing one writes again, from the newest content, until nothing is owed. A failed write is made up
 * by the next event. Before each write, when it is missing: `<dir>/.gitignore` holding `*`, so git
 * ignores the folder in every project with no step from the user. True when this call wrote; false when
 * it left the file to the write in flight, whose result is not known yet. */
export async function writeLatest($: EngineInterface, dir: string, f: Out) {
  if (f.writing) {
    f.owed = true
    return false
  }
  f.writing = true
  try {
    do {
      f.owed = false
      if (!f.ignore) {
        // checked before every write, not once: a user who deletes the folder mid-session gets it back ignored
        let has = f.ignored
        try {
          has = await $.fs.exists(`${dir}/.gitignore`)
        } catch {
          // a host that cannot answer: once per session, as before
        }
        if (!has) await $.fs.write(`${dir}/.gitignore`, '*\n')
        f.ignored = true
      }
      const n = f.newest
      if (n) await $.fs.write(`${dir}/${n.name}`, n.text())
    } while (f.owed)
    return true
  } finally {
    f.writing = false
  }
}
