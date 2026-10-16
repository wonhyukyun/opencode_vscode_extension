## 1. 인터페이스 개요

OpenCode Integrated는 GUI 확장이며 외부에 공개하는 REST API나 라이브러리를 제공하지 않습니다. 연동 지점은 두 가지입니다.

| 구분 | 제공 형태 | 호출 방식 | 인증 |
|---|---|---|---|
| VS Code 명령·단축키·설정 | VS Code 확장 API | 명령 팔레트, 키 바인딩, `settings.json`, 다른 확장의 `executeCommand` | VS Code 권한 모델 |
| 내장 OpenCode 엔진 HTTP API | HTTP/JSON + SSE (엔진 자체 API) | `http://127.0.0.1:<임시포트>` | Basic 인증. 사용자명 `opencode`, 비밀번호는 실행마다 무작위 생성 |

내장 엔진의 포트와 비밀번호는 확장 프로세스 내부에만 존재하며 외부에 노출되지 않습니다. 따라서 엔진 API는 이 확장을 수정·확장하는 개발자용 참고 정보입니다. 엔진 API의 정식 명세는 OpenCode 공식 문서를 따릅니다. [확인필요: OpenCode 서버 API 문서 URL, 버전 정책]

## 2. API 명세

### 2.1 VS Code 명령

| 명령 ID | 제목 | 설명 |
|---|---|---|
| `opencodeIntegrated.open` | OpenCode: Open Chat | 사이드바를 열고 채팅 뷰를 표시 |
| `opencodeIntegrated.newChat` | OpenCode: New Chat | 새 세션을 만들고 선택 |
| `opencodeIntegrated.attachSelection` | OpenCode: Add Selection to Chat | 현재 편집기 선택 영역(없으면 파일)을 다음 메시지에 첨부 |

파라미터는 없습니다. 다른 확장에서 호출하는 예시는 다음과 같습니다.

```typescript
// 값은 예시입니다.
await vscode.commands.executeCommand("opencodeIntegrated.attachSelection")
```

### 2.2 키 바인딩

| 명령 | 기본 키 (Windows/Linux) | macOS |
|---|---|---|
| `opencodeIntegrated.open` | `ctrl+escape` | `cmd+escape` |
| `opencodeIntegrated.newChat` | `ctrl+shift+escape` | `cmd+shift+escape` |

### 2.3 설정

| 이름 | 타입 | 필수 | 설명 | 예시 |
|---|---|---|---|---|
| `opencodeIntegrated.binaryPath` | string | 아니오 | 개발용 엔진 실행 파일 경로 재정의. 빈 값이면 내장 엔진 사용 | `C:\dev\opencode\opencode.exe` (예시) |
| `opencodeIntegrated.defaultModel` | string | 아니오 | `provider/model` 형식 기본 모델. 해당 에이전트에 고른 모델이 아직 없을 때 사용합니다. 설정을 고치면 즉시 적용됩니다. 빈 값이면 OpenCode 기본값 | `anthropic/claude-sonnet-5` (예시) |

`settings.json` 예시:

```json
{
  "opencodeIntegrated.defaultModel": "anthropic/claude-sonnet-5"
}
```

### 2.4 엔진 기동 방식

확장은 다음 명령으로 엔진을 실행합니다.

```text
opencode.exe serve --hostname 127.0.0.1 --port <임시포트> --log-level WARN
```

| 환경 변수 | 값 | 설명 |
|---|---|---|
| `OPENCODE_CALLER` | `vscode-integrated` | 호출 주체 식별 |
| `OPENCODE_SERVER_USERNAME` | `opencode` | Basic 인증 사용자명 |
| `OPENCODE_SERVER_PASSWORD` | 32바이트 무작위 base64url | Basic 인증 비밀번호. 실행마다 재생성 |

모든 요청에는 다음 헤더가 붙습니다.

| 헤더 | 값 |
|---|---|
| `Authorization` | `Basic base64(opencode:<비밀번호>)` |
| `x-opencode-directory` | URL 인코딩한 워크스페이스 절대 경로 |
| `Content-Type` | `application/json` |

### 2.5 확장이 사용하는 엔진 엔드포인트

아래 표는 `src/client.ts`가 호출하는 엔드포인트만 정리한 것입니다. 요청·응답 필드의 전체 정의는 OpenCode 공식 명세를 따릅니다. [확인필요: 공식 명세 링크]

| Method | Endpoint | 설명 |
|---|---|---|
| GET | `/global/health` | 엔진 준비 상태 확인 |
| GET | `/session?scope=project&roots=true&limit=50` | 워크스페이스 세션 목록 |
| GET | `/experimental/session?roots=true&limit=50` | 전체 프로젝트 세션 목록. 항목마다 `project: { id, name?, worktree }`가 포함되어 History 패널의 레포지토리별 묶음에 사용됩니다. 호출이 실패하면 위의 워크스페이스 목록으로 대체됩니다. |
| GET | `/skill` | 엔진이 읽어 들인 스킬 목록. `{ name, description?, location, content }` 형태이며 `location`이 `<built-in>`이면 내장 스킬입니다. Skills 패널에서 사용합니다. |
| GET | `/mcp` | MCP 서버 상태 맵. `{ 서버이름: { status, error? } }` 형태이고 `status`는 `connected`, `disabled`, `needs_auth`, `needs_client_registration`, `failed` 중 하나입니다. MCP Servers 패널에서 사용합니다. |
| POST | `/session` | 세션 생성 |
| PATCH | `/session/{id}` | 세션 권한 규칙 갱신 (`permission` 배열) |
| DELETE | `/session/{id}` | 세션 삭제 |
| GET | `/session/{id}/message?limit=200` | 메시지 목록 |
| POST | `/session/{id}/prompt_async` | 프롬프트 전송 (비동기) |
| POST | `/session/{id}/command` | 슬래시 명령 실행 |
| POST | `/session/{id}/abort` | 진행 중 응답 중단 |
| GET | `/agent` | 에이전트 목록 |
| GET | `/command` | 명령 목록 |
| GET | `/find/file?query=&limit=` | 파일 검색 |
| GET | `/config/providers` | 제공자·모델 목록과 기본값 |
| GET | `/permission` | 대기 중 권한 요청 |
| POST | `/permission/{id}/reply` | 권한 응답 (`once`/`always`/`reject`) |
| GET | `/question` | 대기 중 질문 |
| POST | `/question/{id}/reply` | 질문 응답 (`answers: string[][]`) |
| POST | `/question/{id}/reject` | 질문 거부 |
| GET | `/event` | SSE 이벤트 스트림 |

프롬프트 전송 요청 예시:

```json
{
  "parts": [
    { "type": "text", "text": "이 함수를 설명해 줘" },
    { "type": "file", "mime": "text/plain", "filename": "src/server.ts", "url": "file:///C:/work/proj/src/server.ts" }
  ],
  "model": { "providerID": "anthropic", "modelID": "claude-sonnet-5" },
  "variant": "high",
  "agent": "build"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `parts` | array | 예 | `text` 또는 `file` 파트. 선택 영역은 `data:` URL과 `source.text` 범위로 전달 |
| `model` | object | 아니오 | 생략 시 OpenCode 기본 모델 |
| `variant` | string | 아니오 | 사고 강도. 모델의 `variants` 키 중 하나 |
| `agent` | string | 아니오 | primary 에이전트 이름 |

권한 규칙(PATCH `/session/{id}`) 예시. 권한 모드 `plan`에 해당합니다.

```json
{
  "permission": [
    { "permission": "edit", "pattern": "*", "action": "deny" },
    { "permission": "bash", "pattern": "*", "action": "ask" }
  ]
}
```

SSE 이벤트는 `data:` 줄의 JSON이며 `{ type, properties }` 형태입니다. `payload`로 감싸진 경우도 처리합니다. 확장이 사용하는 이벤트 타입은 `session.*`, `permission.asked`, `question.asked`, `question.replied`, `question.rejected`, `server.connected`입니다.

## 3. 연동 예제

내장 엔진과 동일한 방식으로 엔진을 직접 띄우고 세션을 만드는 예제입니다. 저장소의 `scripts/smoke-server.mjs`와 같은 흐름입니다. 값은 모두 예시입니다.

```javascript
// Node.js 20 이상. 값은 예시입니다.
import { spawn } from "node:child_process"

const port = 43123                      // 예시 포트
const password = "example-only"         // 예시 비밀번호
const baseUrl = `http://127.0.0.1:${port}`
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
const workspace = "C:\\work\\proj"      // 예시 경로

const child = spawn("bin/win32-x64/opencode.exe",
  ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--log-level", "ERROR"],
  { cwd: workspace, env: { ...process.env, OPENCODE_SERVER_PASSWORD: password } })

const headers = {
  authorization,
  "content-type": "application/json",
  "x-opencode-directory": encodeURIComponent(workspace),
}

for (let i = 0; i < 100; i++) {
  try {
    const health = await (await fetch(`${baseUrl}/global/health`, { headers })).json()
    if (health.healthy) break
  } catch {}
  await new Promise((r) => setTimeout(r, 100))
}

const session = await (await fetch(`${baseUrl}/session`, { method: "POST", headers, body: "{}" })).json()
console.log("session id:", session.id)

await fetch(`${baseUrl}/session/${session.id}/prompt_async`, {
  method: "POST", headers,
  body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
})

child.kill()
```

## 4. 오류 코드

확장은 엔진 응답의 `data.message` 또는 `message` 필드를 오류 알림으로 표시합니다. 확장 자체가 생성하는 오류는 다음과 같습니다.

| 코드/메시지 | 의미 | 발생 원인 | 클라이언트 조치 |
|---|---|---|---|
| `Open a folder or workspace before starting OpenCode.` | 워크스페이스 없음 | 폴더를 열지 않음 | 폴더를 열고 재시도 |
| `This extension package does not contain an OpenCode engine for <target>` | 플랫폼 불일치 | 다른 OS·아키텍처용 VSIX 설치 | 맞는 VSIX 설치 |
| `The configured OpenCode executable does not exist: <path>` | 재정의 경로 오류 | `binaryPath` 설정 잘못됨 | 설정 수정 또는 비우기 |
| `Bundled OpenCode engine exited with code <n>` | 엔진 조기 종료 | 실행 차단, 손상된 실행 파일 등 | 출력 채널 로그 확인 |
| `Bundled OpenCode engine did not become ready: <detail>` | 기동 시간 초과(20초) | 헬스체크 실패 | 로그 확인, 보안 SW·포트 점검 |
| `Health check returned HTTP <status>` | 헬스체크 비정상 응답 | 인증 불일치 등 | 로그 확인 후 VS Code 재시작 |
| `Event stream failed with HTTP <status>` | SSE 연결 실패 | 엔진 재시작 중 | 자동으로 0.75초 후 재연결 |
| `OpenCode API returned HTTP <status>` | 엔진 오류 응답(본문 없음) | 요청 오류 | 로그 확인 |
| 엔진 오류 코드 전체 목록 | [확인필요: OpenCode 공식 오류 코드 표] | | |

---
**검증 필요 목록**
- OpenCode 서버 API 공식 문서 URL, 버전 정책(하위 호환, deprecated 표기)
- 엔진 오류 코드 전체 목록
