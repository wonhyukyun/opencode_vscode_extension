> **이용 조건 안내** — 이 SW의 공개 범위 등급은 [확인필요: PUBLIC / INTERNAL / RESTRICTED]입니다. 등급에 따른 이용 범위와 재배포 제한을 확인한 뒤 내려받으십시오. 라이선스(MIT) 및 사내 이용 조건은 [확인필요: 라이선스 및 이용 조건 문서 링크]를 확인하십시오.

## 배포 파일

| 버전 | 파일·링크 | SHA-256 | 배포일 |
|---|---|---|---|
| v0.1.0 (최신) | `opencode-integrated-0.1.0-win32-x64.vsix` [확인필요: 다운로드 링크] | `8c6a32ad24fbf47af4355b16094681a116f699e09e5ed41bf113481573c648b2` (로컬 빌드 기준, 공식 배포본으로 재계산 [확인필요]) | [확인필요] |

현재 Windows x64용 VSIX만 제공합니다. 다른 플랫폼 빌드가 필요하면 담당자 [확인필요]에게 문의하십시오.

## 저장소

- 소스 저장소: [확인필요: URL]
- 접근 권한 신청: [확인필요: 절차]
- 소스에서 직접 빌드하려면 Node.js 20 이상과 npm이 필요합니다.
  ```powershell
  npm install
  npm run package
  ```
  빌드 결과는 `artifacts/opencode-integrated-<버전>-win32-x64.vsix`에 생성됩니다.

## 무결성 검증 방법

내려받은 파일의 SHA-256 값이 위 표의 값과 일치해야 합니다. 일치하지 않으면 설치하지 말고 담당자에게 알리십시오.

Windows (PowerShell):

```powershell
Get-FileHash .\opencode-integrated-0.1.0-win32-x64.vsix -Algorithm SHA256
```

macOS:

```bash
shasum -a 256 opencode-integrated-0.1.0-win32-x64.vsix
```

Linux:

```bash
sha256sum opencode-integrated-0.1.0-win32-x64.vsix
```

---
**검증 필요 목록**
- 공개 범위 등급, 라이선스·이용 조건 문서 링크
- 다운로드 링크, 배포일, 공식 배포본 SHA-256
- 저장소 URL과 접근 권한 신청 절차, 담당자
