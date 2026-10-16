# [1] SW 정보 입력 — OpenCode Integrated

저장소 자료(README.md, PLAN.md, package.json, src/, scripts/, LICENSE, git 로그)에서 추출한 값입니다.
자료에 없는 항목은 `[확인필요]`로 남겼습니다.

- SW명(정식): OpenCode Integrated
- SW명(영문/코드명): OpenCode Integrated / `opencode-integrated`
- 한 줄 설명: OpenCode 엔진을 내장해 별도 CLI 설치나 터미널 없이 VS Code 사이드바에서 AI 코딩 채팅을 사용하는 VS Code 확장입니다.
- 개발 배경: 오픈소스 AI 코딩 에이전트 OpenCode는 CLI/TUI 중심이어서 도입 시 별도 설치와 터미널 사용이 필요했습니다. 이 확장은 플랫폼별 OpenCode 실행 파일을 VSIX에 동봉하고, 루프백 전용 로컬 서버로 구동해 VS Code UI만으로 전 기능을 제공합니다. [확인필요: 국방 융합 관점의 개발 배경·적용 목표]
- 주요 기능 목록:
  - 내장 엔진 자동 기동·종료 (127.0.0.1, 임시 포트, Basic 인증)
  - 스트리밍 채팅과 세션(대화) 목록 관리
  - 모델·사고 강도(effort)·에이전트 선택
  - 편집기 선택 영역·`@파일`·이미지 첨부
  - `/명령` 실행 (OpenCode 명령·스킬)
  - 도구 권한 승인과 권한 모드(Manual/Edit automatically/Plan/Auto)
  - 에이전트 질문 응답, 토큰 사용량 표시
- 최신 버전 / 배포일: v0.1.0 / [확인필요: 배포일]
- 공개 범위 등급: [확인필요: PUBLIC / INTERNAL / RESTRICTED]
- 라이선스: MIT (LICENSE 파일 기준)
- 실행 환경: Windows x64, VS Code 1.94.0 이상. 내장 엔진 `opencode-windows-x64-baseline` 1.18.32. 개발 시 Node.js 20 이상·npm. 최소·권장 사양 [확인필요]
- 배포 형태: 플랫폼별 VSIX (`opencode-integrated-0.1.0-win32-x64.vsix`) / 저장소: [확인필요: URL]
- 인터페이스: GUI (VS Code 사이드바 웹뷰), VS Code 명령·단축키·설정
- 담당자: [확인필요: 이름/직책] / 문의 채널: [확인필요]
- 알려진 제약사항:
  - Windows x64 VSIX만 빌드됨. 다른 OS·아키텍처는 미제공
  - 폴더(워크스페이스)를 열어야 동작
  - 모델 제공자 자격 증명은 확장이 관리하지 않음. OpenCode CLI 또는 설정 파일로 별도 구성
  - 폐쇄망 검증 여부 [확인필요]
