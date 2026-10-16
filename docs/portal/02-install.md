## 1. 목적

이 문서를 따라 하면 Windows x64 PC의 VS Code에 OpenCode Integrated v0.1.0을 설치하고 첫 채팅까지 확인할 수 있습니다. 별도 `opencode` CLI 설치는 필요 없습니다. 예상 소요 시간은 10분 이내입니다. [확인필요: 실측 소요 시간]

## 2. 사전 요구사항

| 항목 | 요구사항 | 확인 명령 |
|---|---|---|
| OS | Windows x64 | `[Environment]::Is64BitOperatingSystem` (PowerShell, `True`면 정상) |
| VS Code | 1.94.0 이상 | `code --version` |
| 권한 | 사용자 계정으로 확장 설치 가능 | 별도 관리자 권한 불필요 [확인필요: 사내 정책] |
| 네트워크 | 확장 자체는 `127.0.0.1` 임시 포트만 사용. 모델 제공자 API 접근 경로 | [확인필요: 제공자 URL·프록시 정책] |
| 배포 파일 | `opencode-integrated-0.1.0-win32-x64.vsix` | 「다운로드」 페이지 참고 |
| 모델 제공자 자격 증명 | OpenCode 설정(`opencode.json`) 또는 OpenCode 자격 증명 저장소에 등록 | [확인필요: 사내 표준 제공자 등록 절차] |

## 3. 설치 절차

### 3.1 배포 파일 무결성 검증

1. 「다운로드」 페이지에서 VSIX 파일을 받습니다.
2. SHA-256 값을 계산합니다.
   ```powershell
   Get-FileHash .\opencode-integrated-0.1.0-win32-x64.vsix -Algorithm SHA256
   ```
   기대 결과: 출력된 `Hash` 값이 「다운로드」 페이지 표의 값과 일치하면 정상입니다.

### 3.2 확장 설치

1. VSIX가 있는 폴더에서 PowerShell을 엽니다.
2. 확장을 설치합니다.
   ```powershell
   code --install-extension .\opencode-integrated-0.1.0-win32-x64.vsix
   ```
   기대 결과: `Extension 'opencode-integrated-0.1.0-win32-x64.vsix' was successfully installed.`가 출력되면 정상입니다.
3. VS Code를 다시 시작합니다.

### 3.3 모델 제공자 구성

1. OpenCode 설정 파일 `opencode.json`에 사용할 제공자와 모델을 등록합니다. [확인필요: 사내 표준 설정 예시]
2. 자격 증명이 필요한 제공자는 OpenCode CLI 또는 설정 파일로 등록합니다. 확장은 자격 증명을 관리하지 않습니다.

### 3.4 (선택) 확장 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| `opencodeIntegrated.binaryPath` | 빈 문자열 | 개발용 엔진 실행 파일 경로 재정의. 일반 설치에서는 비워 둡니다. |
| `opencodeIntegrated.defaultModel` | 빈 문자열 | `provider/model` 형식의 기본 모델. 비우면 OpenCode 설정의 기본값을 사용합니다. |

## 4. 설치 확인

1. VS Code에서 임의의 폴더를 엽니다. 폴더를 열지 않으면 엔진이 시작되지 않습니다.
2. 활동 표시줄의 OpenCode 아이콘을 선택하거나 `Ctrl+Esc`를 누릅니다.
3. 사이드바에 "Starting OpenCode…"가 표시된 뒤 입력창이 활성화되면 정상입니다.
4. 하단 모델 선택 상자에 등록한 모델이 보이는지 확인합니다.
5. 로그를 확인하려면 출력(Output) 패널에서 채널 "OpenCode Integrated"를 선택합니다. `OpenCode engine ready at http://127.0.0.1:<포트>`가 있으면 정상입니다.

## 5. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `This extension package does not contain an OpenCode engine for <platform>` | 설치한 VSIX가 현재 OS·아키텍처용이 아님 | 플랫폼에 맞는 VSIX를 설치합니다. 현재 제공 빌드는 `win32-x64`뿐입니다. |
| `Open a folder or workspace before starting OpenCode.` | 폴더를 열지 않은 상태에서 사이드바를 엶 | 폴더 또는 워크스페이스를 연 뒤 다시 시도합니다. |
| `Bundled OpenCode engine did not become ready` | 20초 내에 엔진 헬스체크 실패. 보안 SW 차단이나 포트 할당 실패 가능 | 출력 채널 "OpenCode Integrated" 로그를 확인합니다. 보안 SW가 `opencode.exe` 실행을 막는지 확인합니다. [확인필요: 사내 보안 SW 예외 등록 절차] |
| `The configured OpenCode executable does not exist: <경로>` | `opencodeIntegrated.binaryPath`에 잘못된 경로 설정 | 설정값을 비우거나 올바른 경로로 수정합니다. |
| 모델 선택 상자가 비어 있음 | OpenCode 설정에 제공자·모델 미등록 또는 자격 증명 누락 | 3.3 절차를 다시 확인합니다. |

---
**검증 필요 목록**
- 실측 설치 소요 시간
- 사내 정책상 관리자 권한 필요 여부, 보안 SW 예외 등록 절차
- 모델 제공자 URL·프록시 정책과 사내 표준 `opencode.json` 예시
