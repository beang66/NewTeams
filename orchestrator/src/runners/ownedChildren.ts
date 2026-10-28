import { spawn, type ChildProcess } from 'node:child_process'

const children = new Set<ChildProcess>()
let stopping = false
let shutdown: Promise<void> | undefined

/** CLI 종료 중에는 완료된 러너/체크가 다음 subprocess를 시작하지 못한다. */
export function assertChildStartAllowed(): void {
  if (stopping) throw new Error('CLI가 종료 중입니다')
}

/** 현재 프로세스에서 직접 시작한 자식만 관리한다. 정상 종료/실패 즉시 등록을 해제한다. */
export function trackOwnedChild(child: ChildProcess): void {
  if (children.has(child)) return
  children.add(child)
  const remove = () => {
    children.delete(child)
    child.off('close', remove)
    child.off('error', remove)
  }
  child.once('close', remove)
  child.once('error', remove)
}

/** 종료 플래그를 동기적으로 설정한 뒤, 소유한 자식의 트리 종료를 기다린다. */
export function stopOwnedChildren(): Promise<void> {
  stopping = true
  shutdown ??= Promise.allSettled([...children].map(killOwnedTree)).then(results => {
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), '자식 프로세스 종료 실패')
  })
  return shutdown
}

async function killOwnedTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', reject)
      killer.once('close', code => {
        if (code === 0 || !children.has(child)) resolve()
        else reject(new Error(`자식 프로세스 트리 종료 실패: ${child.pid}`))
      })
    })
  } else {
    // 관리 대상은 detached로 생성한 전용 프로세스 그룹이다.
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}
