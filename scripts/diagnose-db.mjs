// Reports what takes up space in the OpenCode engine database, to find chats that make the engine
// run out of memory. Read-only; prints sizes, counts and file names, never file contents.
//
// Run with the bundled engine, which doubles as a Bun runtime:
//   $env:BUN_BE_BUN = "1"; & <path>\opencode.exe scripts\diagnose-db.mjs [db path] [session id]
// scripts\diagnose-db.ps1 does this for an installed extension.
import { Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
// Arguments are told apart by shape, since Windows PowerShell drops empty ones when calling an exe.
const args = process.argv.slice(2).filter(Boolean)
const focusSession = args.find((arg) => arg.startsWith("ses_"))
const dbPath = args.find((arg) => !arg.startsWith("ses_")) || path.join(dataHome, "opencode", "opencode.db")
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })
const mb = (bytes) => `${((bytes ?? 0) / 1048576).toFixed(1)} MB`
const all = (sql, ...params) => db.query(sql).all(...params)
const tables = new Set(all("select name from sqlite_master where type = 'table'").map((row) => row.name))
const section = (title) => console.log(`\n== ${title}`)

console.log(`OpenCode database: ${dbPath} (${mb(statSync(dbPath).size)} on disk)`)
console.log(`Report time: ${new Date().toISOString()}`)

section("Table sizes")
for (const table of ["message", "part", "event", "session"]) {
  if (!tables.has(table)) continue
  const column = table === "session" ? "coalesce(length(summary_diffs), 0)" : "length(data)"
  const row = db.query(`select count(*) as rows, sum(${column}) as bytes from ${table}`).get()
  console.log(`${table.padEnd(8)} rows=${String(row.rows).padStart(7)}  data=${mb(row.bytes)}`)
}

section("Largest chats (messages + parts)")
const sessions = all(`
  select s.id, s.title, s.directory, coalesce(length(s.summary_diffs), 0) as sessionDiffs,
         coalesce(m.bytes, 0) as messageBytes, coalesce(m.count, 0) as messages, coalesce(p.bytes, 0) as partBytes
  from session s
  left join (select session_id, sum(length(data)) as bytes, count(*) as count from message group by session_id) m on m.session_id = s.id
  left join (select session_id, sum(length(data)) as bytes from part group by session_id) p on p.session_id = s.id
  order by messageBytes + partBytes + sessionDiffs desc
  limit 10`)
for (const s of sessions) {
  console.log(`${s.id}  total=${mb(s.messageBytes + s.partBytes + s.sessionDiffs)}  messages=${s.messages}  ` +
    `message data=${mb(s.messageBytes)}  parts=${mb(s.partBytes)}  session diffs=${mb(s.sessionDiffs)}`)
  console.log(`    "${s.title ?? ""}"  ${s.directory ?? ""}`)
}

section("Largest messages")
const messages = all(`
  select id, session_id, length(data) as bytes, json_extract(data, '$.role') as role,
         coalesce(json_array_length(data, '$.summary.diffs'), 0) as files,
         coalesce(length(json_extract(data, '$.summary')), 0) as summaryBytes
  from message
  ${focusSession ? "where session_id = ?" : ""}
  order by bytes desc
  limit 10`, ...(focusSession ? [focusSession] : []))
for (const m of messages) {
  console.log(`${m.id}  ${m.session_id}  ${m.role}  size=${mb(m.bytes)}  summary=${mb(m.summaryBytes)}  diff files=${m.files}`)
}

section("Diff contents of the 3 largest messages")
for (const m of messages.slice(0, 3)) {
  if (!m.files) continue
  console.log(`-- ${m.id} (${m.files} files)`)
  const statuses = all(`
    select json_extract(value, '$.status') as status, count(*) as count, sum(length(value)) as bytes
    from message, json_each(message.data, '$.summary.diffs') where message.id = ?
    group by status order by bytes desc`, m.id)
  console.log(`   by status: ${statuses.map((row) => `${row.status} ${row.count} files ${mb(row.bytes)}`).join(", ")}`)
  const files = all(`
    select json_extract(value, '$.file') as file, json_extract(value, '$.status') as status, length(value) as bytes
    from message, json_each(message.data, '$.summary.diffs') where message.id = ?
    order by bytes desc limit 15`, m.id)
  for (const file of files) console.log(`   ${mb(file.bytes).padStart(9)}  ${String(file.status).padEnd(8)}  ${file.file}`)
}

if (!focusSession) {
  section("Largest parts")
  const parts = all(`
    select session_id, json_extract(data, '$.type') as type, json_extract(data, '$.tool') as tool,
           json_extract(data, '$.mime') as mime, length(data) as bytes
    from part order by bytes desc limit 10`)
  for (const part of parts) {
    console.log(`${mb(part.bytes).padStart(9)}  ${part.session_id}  ${part.type}${part.tool ? `:${part.tool}` : ""}${part.mime ? ` ${part.mime}` : ""}`)
  }
}

db.close()
