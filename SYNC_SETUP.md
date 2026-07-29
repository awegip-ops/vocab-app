# 휴대폰·PC 동시 사용 + 진도 동기화 설정 가이드

이 앱은 이제 두 가지가 준비되어 있습니다.

1. **온라인 배포**: 어디서든 URL로 접속 (휴대폰 데이터/와이파이 상관없이 접속 가능)
2. **실시간 동기화**: 6자리 코드로 기기끼리 연결하면 학습 진도가 자동으로 합쳐짐

코드는 이미 다 구현되어 있고, **아래 두 단계만 직접 진행**하시면 됩니다. 둘 다 계정 로그인이 필요한 부분이라 제가 대신 할 수 없습니다.

---

## 1단계. Firebase 프로젝트 만들기 (동기화용, 무료)

1. https://console.firebase.google.com 접속 → 구글 계정으로 로그인
2. **"프로젝트 추가"** 클릭 → 프로젝트 이름 입력(예: `vocab-app`) → 애널리틱스는 꺼도 됨 → 프로젝트 만들기
3. 왼쪽 메뉴 **빌드 > Firestore Database** → **데이터베이스 만들기** → 위치는 아무 곳이나(가까운 asia 계열 추천) → **프로덕션 모드**로 시작
4. Firestore가 만들어지면 상단 **규칙(Rules)** 탭으로 가서 아래 내용으로 전체 교체 후 **게시**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /syncCodes/{code} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   (익명 로그인한 사용자만 접근 가능하고, 정확한 6자리 코드를 알아야 해당 문서에 접근할 수 있습니다.)

   > **참고 — 더 안전하게 하려면**: 위 규칙은 6자리 코드(약 12억 조합)를 아는 사람이면 누구나
   > 접근할 수 있다는 뜻이고, 코드 만료 기한이 없습니다. 개인 사용에는 충분하지만, 더 보수적으로
   > 가려면 "90일 이상 동기화가 없었던 코드는 자동으로 접근 차단" 규칙으로 바꿀 수 있습니다:
   > ```
   > rules_version = '2';
   > service cloud.firestore {
   >   match /databases/{database}/documents {
   >     match /syncCodes/{code} {
   >       allow read, write: if request.auth != null
   >         && (!("updatedAt" in resource.data)
   >             || request.time < resource.data.updatedAt + duration.value(90, 'd'));
   >     }
   >   }
   > }
   > ```
   > 이 방식은 90일 넘게 안 쓴 동기화 코드가 자동으로 무효화되어, 예전에 코드가 유출됐더라도
   > 위험이 계속 남지 않게 해줍니다. 앱 쪽은 이미 동기화 실패를 조용히 처리하도록(로컬 저장은
   > 그대로 유지) 되어 있어 코드가 만료돼도 앱이 깨지지 않습니다. 적용은 Firebase 콘솔 규칙
   > 탭에서 직접 붙여넣고 게시해야 하며, 계정 로그인이 필요해 대신 해드릴 수 없습니다.
5. 왼쪽 메뉴 **빌드 > Authentication** → **시작하기** → **Sign-in method** 탭 → **익명(Anonymous)** 클릭 → 사용 설정 → 저장
6. 왼쪽 위 톱니바퀴 ⚙️ → **프로젝트 설정** → 아래로 스크롤 **내 앱** → 웹 아이콘(`</>`) 클릭 → 앱 닉네임 입력(예: `web`) → 앱 등록
7. 화면에 나오는 `firebaseConfig` 객체를 복사

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "vocab-app-xxxxx.firebaseapp.com",
     projectId: "vocab-app-xxxxx",
     storageBucket: "vocab-app-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef",
   };
   ```

8. 이 프로젝트의 **[js/firebase-config.js](js/firebase-config.js)** 파일을 열어서 `YOUR_...` 부분을 방금 복사한 값으로 바꿔주세요. (이 파일만 수정하면 끝입니다.)

설정이 끝나면 앱의 **통계/설정** 화면에 "📱💻 기기 간 동기화" 섹션이 활성화되어 코드 생성 버튼이 나타납니다.

---

## 2단계. 무료 온라인 배포 (Vercel 추천)

### 방법 A — Vercel (가장 간단, 계정 필요)

1. https://vercel.com 접속 → GitHub 계정(없으면 새로 만들기)으로 가입
2. 이 폴더(`영어단어장`)를 GitHub 저장소에 올려야 합니다. 터미널에서:
   ```
   cd "C:\Users\tast\Desktop\제작 앱\영어단어장"
   git init
   git add .
   git commit -m "Initial commit"
   ```
   그다음 GitHub 웹사이트에서 새 저장소를 만들고, 안내되는 명령어로 push하세요.
3. Vercel 대시보드에서 **Add New > Project** → 방금 만든 GitHub 저장소 선택 → Framework Preset은 **Other**(그대로 둬도 됨) → **Deploy**
4. 배포가 끝나면 `https://내프로젝트이름.vercel.app` 같은 URL이 생깁니다. 이 주소를 PC와 휴대폰 브라우저 둘 다에서 열면 됩니다.
5. 이후 코드를 수정할 때마다 `git add . && git commit -m "update" && git push` 하면 Vercel이 자동으로 재배포합니다.

### 방법 B — GitHub Pages (Vercel 계정 없이, GitHub만)

1. GitHub에 저장소를 만들고 위와 같이 push
2. 저장소 **Settings > Pages** → Source를 **Deploy from a branch** → `main` 브랜치, `/ (root)` 선택 → Save
3. 몇 분 후 `https://내아이디.github.io/저장소이름/` 에서 접속 가능

---

## 사용 방법 (배포 + Firebase 설정 완료 후)

1. PC 브라우저에서 배포된 URL 접속 → **통계/설정** → **"새 동기화 코드 만들기"** 클릭 → 6자리 코드(예: `AB3D9K`)가 표시됨
2. 휴대폰 브라우저에서 같은 URL 접속 → **통계/설정** → 코드 입력창에 그 6자리 코드 입력 → **연결하기**
3. 이후로는 두 기기 중 어디서 단어를 학습하든 자동으로(약 1~2초 후) 서로 진도가 합쳐집니다. 실시간으로 반영되며, 별도 로그인/비밀번호가 필요 없습니다.
4. 코드는 각 기기에 저장되므로 한 번만 연결하면 됩니다. 필요하면 통계/설정 화면에서 "동기화 해제"를 눌러 끊을 수 있습니다(로컬 학습 기록은 유지됨).

### 참고

- 진도 병합 규칙: 단어별로 "복습 누적 횟수"가 더 높은 기록을 최신으로 간주해 합칩니다. 즉 어느 기기에서 공부하든 진행 상황을 잃어버리지 않습니다.
- Firebase 무료 요금제(Spark)로 개인 사용에는 충분합니다.
- Firebase 설정을 하지 않아도 앱 자체는 지금처럼 각 기기에서 정상 작동합니다(동기화만 비활성).
