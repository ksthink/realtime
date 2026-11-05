# 어서 놔요, 소원 돌탑

말랑이 캐릭터를 직접 빚어 숲속 마을을 돌아다니며, 돌을 주워 탑을 쌓고 소원을 비는 실시간 멀티플레이 3D 웹 게임입니다. 로그인 없이 브라우저에서 바로 들어갈 수 있고, 다른 사람의 움직임과 탑, 소원이 실시간으로 보입니다.

![소원 푯말이 달린 돌탑들과 두 캐릭터](docs/screenshots/08-wish-sign.jpg)

> 스크린샷은 로컬 환경에서 찍었으며, 이름·소원과 일부 탑은 촬영용 예시입니다.

## 게임 방법

### 1. 입장과 캐릭터 만들기

인트로에서 현재 접속자 수를 확인하고 **입장**을 누릅니다. 정원은 50명입니다.

![인트로 화면](docs/screenshots/01-intro.jpg)

처음 들어오면 말랑이를 빚습니다.

- 몸통을 드래그해 밀고 당기고, 빈 곳을 드래그해 돌려 봅니다.
- 구, 네모, 별 같은 처음 모양을 고르거나 **매끈하게**, **다른 색**, **초기화**를 쓸 수 있습니다.
- 이름은 최대 12자입니다. **입장**을 누를 때 화면에 보이는 쪽이 얼굴이 됩니다.

![캐릭터 빚기 화면](docs/screenshots/02-sculpt.jpg)

### 2. 돌을 주워 탑 쌓기

1. 돌 가까이 가면 줍게 될 돌 아래에 은빛 표시가 나타납니다. **E**로 줍습니다. 한 번에 하나만 들 수 있습니다.
2. 탑을 놓을 곳에서 다시 **E**를 누르면 첫 돌이 놓이고 내 탑이 생깁니다. 다른 탑과 2m 이상 떨어져 있어야 합니다.
3. 돌을 더 주워 첫 돌에서 1.8m 안에 놓으면 한 층씩 쌓입니다. 그보다 멀리 놓으면 돌은 그 자리에 버려집니다.

알아 두면 좋은 규칙입니다.

- 탑은 한 사람당 하나, 최대 10층입니다.
- 작은 돌 위에 큰 돌을 올릴수록 크게 어긋나고, 중심이 벗어나면 **탑이 무너집니다.** 탑과 소원은 사라지고 돌은 주변에 흩어집니다.
- 바닥의 돌은 4~12분이 지나면 사라지고, 새 돌이 계속 생깁니다.
- 내 탑의 돌이 첫 돌 하나뿐일 때 그 돌을 집으면 다시 쌓을지 묻습니다. **네**를 고르면 탑이 없어지고 돌은 바닥에 남습니다.

### 3. 소원 빌기

탑이 5층이 되면 소원을 지금 빌지 나중에 빌지 묻습니다. **나중**을 고르면 10층까지 계속 쌓을 수 있고, 10층이 되면 다시 소원을 빌라는 안내가 나옵니다. 5층 이상이면 **F**로 언제든 빌 수 있습니다.

![5층에서 나오는 소원 안내](docs/screenshots/06-wish-prompt.jpg)

소원은 최대 24자입니다.

![소원 입력 창](docs/screenshots/07-wish-form.jpg)

소원을 빌면 탑은 마을에 남고 소유권은 사라지므로, 곧바로 새 탑을 시작할 수 있습니다. 탑 위 푯말에는 이름, 소원, 남은 시간이 표시됩니다. 소원이 두 줄을 넘으면 말줄임표로 줄어들고, 푯말을 클릭하거나 터치하면 펼치고 접을 수 있습니다.

### 4. 합장으로 탑 지키기

탑의 수명은 24시간입니다. 탑 가까이(3.2m 안)에서 **Q**로 합장하면 수명이 1시간 늘어납니다. 다른 사람의 탑에도 할 수 있고, 같은 탑에는 10분에 한 번만 할 수 있습니다. 수명이 다한 탑은 사라집니다.

### 조작법

화면 오른쪽 아래의 **?** 버튼으로 게임 안에서도 볼 수 있습니다.

![조작 방법 창](docs/screenshots/09-help.jpg)

| 동작 | PC | 모바일 |
| --- | --- | --- |
| 이동 | `W` `A` `S` `D` 또는 방향키 | 왼쪽 아래 조이스틱 |
| 줍기 / 놓기 | `E` 또는 `Space` | **줍기**(**놓기**) 버튼 |
| 합장 | `Q` | **합장** 버튼 |
| 소원 적기 | `F` | **소원** 버튼 |
| 뷰 전환(따라가기 / 하늘에서) | `C` | **뷰** 버튼 |
| 카메라 돌리기 | 화면 드래그 | 화면 드래그 |
| 카메라 거리 | 마우스 휠 | - |
| 쉬기, 인사, 기쁨, 슬픔 | 아래쪽 아이콘 클릭 | 아래쪽 아이콘 터치 |
| 캐릭터 다시 빚기 | 오른쪽 위 아이콘 클릭 | 오른쪽 위 아이콘 터치 |

리액션은 움직이면 끝나고, 돌을 든 채로는 할 수 없습니다.

<img src="docs/screenshots/11-mobile.jpg" alt="모바일 화면의 조이스틱과 버튼" width="300">

### 내 정보는 어떻게 유지되나요

회원가입 없이 Supabase 익명 계정을 씁니다. 세션은 브라우저 저장소에 남기 때문에 같은 브라우저로 다시 오면 캐릭터와 탑이 이어지고, 다른 기기나 브라우저에서는 새 사람으로 시작합니다.

## 직접 실행하기

### 준비물

- Node.js 20 이상
- Docker (로컬 Supabase 실행용)
- `psql` (규칙 테스트 실행용)

### 로컬에서 실행

```bash
# 1. 패키지 설치
npm install

# 2. 로컬 Supabase 시작 (마이그레이션이 함께 적용됩니다)
npx supabase start

# 3. 환경변수 파일 만들기
cp .env.example .env.local
```

`npx supabase status`에 나오는 API URL과 publishable 키를 `.env.local`에 넣습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

```bash
# 4. 개발 서버 실행
npm run dev
```

<http://localhost:3000>을 열면 됩니다. 멀티플레이를 확인하려면 다른 브라우저나 시크릿 창으로 하나 더 접속하세요.

### 운영 환경에 배포

1. Supabase 프로젝트를 만들고 **Authentication**에서 익명 로그인(Anonymous sign-ins)을 켭니다.
2. `supabase/migrations`의 파일을 이름 순서대로 모두 적용합니다.

   ```bash
   npx supabase link --project-ref <프로젝트 ref>
   npx supabase db push
   ```

3. 호스팅 환경에 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정하고 빌드합니다.

   ```bash
   npm run build
   npm start
   ```

> `supabase/apply-all.sql`에는 최근 마이그레이션이 빠져 있습니다. 대신 `supabase/migrations`를 적용하세요.

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 운영 빌드와 실행 |
| `npm run typecheck` | 타입 검사 |
| `npm test` | 서버 규칙 테스트 (아래 환경변수 필요) |
| `npm run gen:spawn` | 돌이 생기는 지점 다시 생성 (지형을 바꿨을 때) |

## 테스트

**서버 규칙 테스트**는 로컬 Supabase를 상대로 돌립니다. 데이터를 직접 고치므로 운영 DB에 연결하면 안 됩니다.

```bash
SB_URL=http://127.0.0.1:54321 \
SB_KEY=<publishable 키> \
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
npm test
```

**브라우저 테스트**는 실제 브라우저로 입장부터 소원, 붕괴, 새로고침까지 확인합니다. GPU가 없는 서버에서는 10분 정도 걸립니다.

```bash
npx playwright install chromium
npm run build && npx next start -p 3100

# 다른 터미널에서. 마지막 인자는 스크린샷을 저장할 폴더입니다(미리 있어야 합니다)
NODE_OPTIONS=--experimental-websocket node --env-file=.env.local tests/e2e.mjs http://localhost:3100 .
```

주소 끝에 `?debug`를 붙이면 브라우저 콘솔에서 `window.__doltap`으로 게임 상태를 볼 수 있습니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `app/` | Next.js 진입점과 전역 스타일 |
| `components/` | 인트로, 캐릭터 빚기, 게임 화면과 HUD |
| `lib/game.ts` | 게임 루프, 입력, 카메라, 돌과 탑 상태 |
| `lib/net.ts` | Supabase 실시간 통신과 RPC 호출 |
| `lib/rules.ts` | 화면 표시용 규칙 값 (판정은 서버가 합니다) |
| `lib/terrain.ts` | 지형, 호수, 다리 |
| `lib/three/` | 3D 요소: 캐릭터, 돌, 푯말, 물, 숲, 꽃잎 |
| `supabase/migrations/` | 테이블, 권한, 게임 규칙 RPC |
| `tests/` | 서버 규칙 테스트와 브라우저 테스트 |

돌 줍기, 쌓기, 붕괴, 합장, 소원 판정은 모두 Postgres RPC가 내리므로 클라이언트가 규칙을 바꿀 수 없습니다. 돌과 탑의 변경은 Realtime의 테이블 변경 이벤트로, 캐릭터 위치와 접속자 수는 Broadcast와 Presence로 전달합니다.

**기술 스택:** Next.js 16, React 19, React Three Fiber, three.js, Supabase(Postgres, Realtime, 익명 인증), TypeScript
