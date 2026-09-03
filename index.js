const { chromium } = require("playwright");

const ID = process.env.INDUK_ID;
const PASSWORD = process.env.INDUK_PASSWORD;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_VARIABLE_NAME = "LAST_NOTICE_NUMBER";

// ========================================
// 인덕대학교 로그인
// ========================================

async function login(page) {
  console.log("인덕대학교 포털 접속 중...");

  await page.goto("https://portal.induk.ac.kr/", {
    waitUntil: "domcontentloaded",
  });

  const loginId = page.locator('input[name="login_id"]');
  const password = page.locator('input[name="user_password"]');

  // 로그인 페이지인지 확인
  if ((await loginId.count()) > 0) {
    console.log("로그인 페이지 확인");

    await loginId.fill(ID);
    await password.fill(PASSWORD);

    await password.press("Enter");

    await page.waitForTimeout(3000);
  }

  // SSO 페이지에 남아있다면 로그인 실패
  if (page.url().includes("sso.induk.ac.kr")) {
    throw new Error("로그인에 실패했습니다.");
  }

  console.log("로그인 성공");
  console.log(`현재 URL: ${page.url()}`);
}

// ========================================
// 공지사항 가져오기
// ========================================

async function getNotices(page) {
  console.log("공지사항 페이지 접속 중...");

  await page.goto("https://portal.induk.ac.kr/p/BO06", {
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector('ul[data-name="post_list"]');

  const notices = await page
    .locator('ul[data-name="post_list"]')
    .evaluateAll((posts) => {
      return posts.map((post) => {
        const getText = (selector) => {
          const element = post.querySelector(selector);
          return element?.textContent.trim() || "";
        };

        const titleElement = post.querySelector(".txt_title");

        const number = getText(".bc-s-post_seq");
        const title = titleElement?.textContent.trim() || "";
        const category = getText(".bc-s-prefix");
        const author = getText(".bc-s-cre_user_name");
        const date = getText(".bc-s-cre_dt");
        const views = getText(".bc-s-visit_cnt");

        const relativeUrl = post.getAttribute("data-url");

        const url = relativeUrl
          ? new URL(relativeUrl, location.origin).href
          : "";

        return {
          number,
          title,
          category,
          author,
          date,
          views,
          url,
        };
      });
    });

  console.log(`${notices.length}개의 공지를 가져왔습니다.`);

  return notices;
}

// ========================================
// GitHub Repository Variable 읽기
// ========================================

async function loadLastNoticeNumber() {
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) {
    throw new Error("GITHUB_REPOSITORY 또는 GITHUB_TOKEN 환경변수가 없습니다.");
  }

  const url =
    `https://api.github.com/repos/${GITHUB_REPOSITORY}` +
    `/actions/variables/${GITHUB_VARIABLE_NAME}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(`GitHub Variable 조회 실패: ${response.status} ${text}`);
  }

  const data = await response.json();

  const number = Number(data.value);

  if (!Number.isInteger(number)) {
    throw new Error(
      `LAST_NOTICE_NUMBER 값이 올바른 숫자가 아닙니다: ${data.value}`,
    );
  }

  return number;
}

// ========================================
// GitHub Repository Variable 업데이트
// ========================================

async function saveLastNoticeNumber(number) {
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) {
    throw new Error("GITHUB_REPOSITORY 또는 GITHUB_TOKEN 환경변수가 없습니다.");
  }

  const url =
    `https://api.github.com/repos/${GITHUB_REPOSITORY}` +
    `/actions/variables/${GITHUB_VARIABLE_NAME}`;

  const response = await fetch(url, {
    method: "PATCH",

    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      name: GITHUB_VARIABLE_NAME,
      value: String(number),
    }),
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `GitHub Variable 업데이트 실패: ${response.status} ${text}`,
    );
  }

  console.log(`LAST_NOTICE_NUMBER 업데이트 완료: ${number}`);
}

// ========================================
// 새 공지 찾기
// ========================================

function findNewNotices(notices, lastNoticeNumber) {
  // "공지" 같은 고정 게시물 제외
  const normalNotices = notices.filter((notice) => /^\d+$/.test(notice.number));

  // 최신 공지부터 정렬
  const sortedNotices = normalNotices.sort(
    (a, b) => Number(b.number) - Number(a.number),
  );

  if (sortedNotices.length === 0) {
    return {
      newNotices: [],
      latestNumber: lastNoticeNumber,
    };
  }

  const latestNumber = Number(sortedNotices[0].number);

  const newNotices = sortedNotices.filter(
    (notice) => Number(notice.number) > Number(lastNoticeNumber),
  );

  return {
    newNotices,
    latestNumber,
  };
}

// ========================================
// Telegram 메시지 전송
// ========================================

async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없습니다.");
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram 메시지 전송 실패: ${JSON.stringify(data)}`);
  }

  console.log("Telegram 메시지 전송 성공");
}

// ========================================
// 공지 → Telegram 메시지 변환
// ========================================

function createTelegramMessage(notice) {
  return [
    "🆕 인덕대학교 새 공지",
    "",
    `[${notice.number}] ${notice.title}`,
    "",
    `📁 분류: ${notice.category || "-"}`,
    `👤 작성자: ${notice.author || "-"}`,
    `📅 날짜: ${notice.date || "-"}`,
    "",
    `🔗 ${notice.url}`,
  ].join("\n");
}

// ========================================
// 메인
// ========================================

(async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ------------------------------------
    // 1. 로그인
    // ------------------------------------

    await login(page);

    // ------------------------------------
    // 2. 공지사항 가져오기
    // ------------------------------------

    const notices = await getNotices(page);

    // ------------------------------------
    // 3. 마지막으로 확인한 공지 번호 가져오기
    // ------------------------------------

    const lastNoticeNumber = await loadLastNoticeNumber();

    console.log(`마지막 확인 공지: ${lastNoticeNumber}`);

    // ------------------------------------
    // 4. 새 공지 확인
    // ------------------------------------

    const result = findNewNotices(notices, lastNoticeNumber);

    console.log(`새 공지 ${result.newNotices.length}개 발견`);

    // ------------------------------------
    // 5. 새 공지가 없으면 종료
    // ------------------------------------

    if (result.newNotices.length === 0) {
      console.log("새 공지가 없습니다.");
      return;
    }

    // ------------------------------------
    // 6. 새 공지 Telegram 전송
    // ------------------------------------

    // 오래된 공지부터 보내기
    const newNotices = [...result.newNotices].reverse();

    for (const notice of newNotices) {
      console.log(`[${notice.number}] ${notice.title}`);

      const message = createTelegramMessage(notice);

      await sendTelegramMessage(message);
    }

    // ------------------------------------
    // 7. Telegram 전송 성공 후
    //    마지막 공지 번호 업데이트
    // ------------------------------------

    await saveLastNoticeNumber(result.latestNumber);
  } catch (error) {
    console.error("오류:", error);

    // 오류가 발생하면
    // LAST_NOTICE_NUMBER를 업데이트하지 않음
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
