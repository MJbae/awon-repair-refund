# 아원데코빌 장기수선 정산

서울 서초구 매헌로6길 46 아원데코빌의 세대별 장기수선비를 계산하는 정적 웹페이지입니다. 프로젝트·저장소 이름은 `awon-repair-refund`이며, 요청한 로컬 작업 경로 `cal`을 유지합니다.

## 실행

Node.js 22 이상에서 실행합니다.

```sh
npm ci
npm run dev
```

[로컬 계산기](http://127.0.0.1:4173)를 엽니다. 브라우저가 JavaScript 모듈과 JSON을 읽어야 하므로 `index.html` 파일을 직접 여는 대신 HTTP 서버를 사용합니다. 앱 자체에는 외부 라이브러리·서버 API·로그인·분석 도구가 없습니다. `happy-dom`은 개발용 입력 흐름 테스트에만 사용합니다.

## 기능

- 호수 선택, 연도·월 드롭다운, 고정 기본 연도 2024년, 최초 24개월 자동 채움, 양 끝 월 포함 개월 수 표시.
- 2024-01~2026-12 단지 월 280,000원 기본 가정, 공급면적 비례 계산.
- 일괄·기간별·개별 월 금액 변경, 부분월 일할 계산, 세대 실제 납부액 입력, 소유자 납부 제외, 반환금 차감.
- 미래 월 예상액·금액 미입력 구간 분리, 기간·호수 변경 시 수정값 보존.
- 월별 계산 내역·계산 기준·법적 근거를 펼쳐보는 상세 카드, 호수별 면적표와 간결한 자료 출처.
- 페이지 맨 아래의 ‘법적 근거’ 카드에서 반환·지급 조항을 펼쳐 확인.
- 입력 내용은 현재 페이지 메모리에서만 유지하며 새로고침하면 초기화. 별도 기기 저장·복사·인쇄 UI 없음.

호수를 선택하면 면적이 옆에 작게 표시되고 자동 적용됩니다. 1~4층 8세대(101~402호)는 149.68㎡, 501호 117.04㎡(B), 502호 144.37㎡, 601호 70.81㎡, 602호 114.27㎡(A), 701호 36.22㎡, 702호 82.92㎡입니다. 호수별 연결은 사용자 제공 자료에 따르며, 이전 버전의 저장값은 읽지 않으며 새 면적 매핑에 영향을 주지 않습니다. 면적 입력·복사·인쇄 버튼은 제공하지 않습니다.

계산 결과는 관리비에 장기수선비가 포함되어 세대 면적 비율만큼 납부했다는 가정에 따른 추정액입니다. 별도 관리인 없이 순번 총무와 공용 통장으로 관리하는 상황을 반영했습니다. 실제 입력액은 면적 계산보다 우선하지만 증빙 확인 완료를 뜻하지는 않습니다.

## 검증과 배포 파일

```sh
npm run check
```

계산·DOM 입력 흐름 테스트, Python의 독립 분수 계산과 1,641개 사례 비교, 자료 검증, JavaScript 문법 검사 후 `dist/`에 공개할 정적 파일만 모읍니다. 정밀 검산에는 Python 3.10 이상이 필요합니다. 추가로 `npm run test:mutations`를 실행하면 9종 계산 오류를 테스트가 잡아내는지 확인합니다. [계산 정밀도 검증](docs/CALCULATION_AUDIT.md)과 [검증 기록](docs/VERIFICATION.md)에 결과를 정리했습니다.

원본 `images/`, `docs/private/`, 로컬 입력 내역은 Git 추적·배포에서 제외합니다. 빌드 스크립트도 허용된 공개 파일 10개와 `.nojekyll`만 복사합니다.

## GitHub Pages

저장소는 [MJbae/awon-repair-refund](https://github.com/MJbae/awon-repair-refund)이며, `origin`과 기본 작업 브랜치 `main`을 사용합니다. 이 로컬 저장소의 커밋 작성자는 `MJbae <gentlygogo@gmail.com>`으로 설정했습니다.

```sh
npm run check
git add .gitignore README.md package.json package-lock.json site scripts tests .github docs/PLAN.md docs/VERIFICATION.md
git commit -m "Update Awon repair refund calculator"
git push -u origin main
```

저장소의 **Settings → Pages → Source**는 **GitHub Actions**로 설정했습니다. 포함된 워크플로가 검증 후 `dist/`를 배포합니다. `Deploy from a branch`의 `main /`로 바꾸면 계산기 대신 루트 README가 게시되므로 이 설정을 유지합니다. 필요하면 Actions에서 수동 실행할 수 있습니다. PR에서는 검증만 진행합니다.

배포 주소는 [아원데코빌 계산기](https://mjbae.github.io/awon-repair-refund/)이며 모든 앱 자산은 상대 경로를 사용합니다. 로컬에서도 `/awon-repair-refund/` 경로로 실행해 볼 수 있습니다.

## 자료 수정

- [건물·면적](site/data/building.json): 면적은 0.01㎡ 단위 정수로 저장하며 총면적도 함께 갱신합니다.
- [기본 가정](site/data/reserve-defaults.json): 적용 기간과 단지 월 적립액.
- [관측 기록](site/data/reserve-observations.json): 개인 정보 없는 출금 3건. 기본 가정과 분리되어 있습니다.
- [법령](site/data/legal.json): 조문·원문 링크·시행일·확인일.
- [작업 계획서](docs/PLAN.md): 운영 가정, 조사 근거와 상세 동작 규칙.

기본 자료 수정 후 `npm run check`를 실행하고 푸시하면 같은 절차로 재배포됩니다.
