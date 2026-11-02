import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listSkills, parseSkill } from '../../src/skills/skills.js'

let home: string
let repo: string
const put = async (path: string, text: string) => { await fs.mkdir(join(path, '..'), { recursive: true }); await fs.writeFile(path, text) }
beforeEach(async () => { home = await fs.mkdtemp(join(tmpdir(), 'skills-home-')); repo = await fs.mkdtemp(join(tmpdir(), 'skills-repo-')) })
afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); await fs.rm(repo, { recursive: true, force: true }) })

describe('skills', () => {
  it('머리말의 한 줄·여러 줄 description을 읽는다', () => {
    expect(parseSkill('---\nname: a\ndescription: "한 줄"\n---\n본문')).toEqual({ name: 'a', desc: '한 줄' })
    expect(parseSkill('---\nname: b\ndescription: >\n  첫 줄\n  둘째 줄\nlicense: x\n---')).toEqual({ name: 'b', desc: '첫 줄 둘째 줄' })
    expect(parseSkill('머리말 없음')).toBeNull()
  })
  it('사용자·저장소·켜진 플러그인 스킬만 모은다', async () => {
    await put(join(home, '.claude/skills/ponytail/SKILL.md'), '---\nname: ponytail\ndescription: lazy\n---')
    await put(join(repo, '.claude/skills/impeccable/SKILL.md'), '---\nname: impeccable\ndescription: ui\n---')
    const on = join(home, 'cache/on/1.0'), off = join(home, 'cache/off/1.0')
    await put(join(on, 'skills/brainstorming/SKILL.md'), '---\nname: brainstorming\ndescription: ideas\n---')
    await put(join(off, 'skills/hidden/SKILL.md'), '---\nname: hidden\ndescription: x\n---')
    await put(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'sp@m': true, 'off@m': false } }))
    await put(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'sp@m': [{ installPath: on }], 'off@m': [{ installPath: off }] } }))
    expect((await listSkills(repo, home)).map((s) => `${s.source}:${s.name}`)).toEqual(['project:impeccable', 'user:ponytail', 'plugin:sp:brainstorming'])
  })
})
