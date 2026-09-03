const path = require("node:path");
const fs = require("fs");
const { chromium } = require("playwright");

process.loadEnvFile(path.join(__dirname, ".env"));

const ID = process.env.INDUK_ID;
const PASSWORD = process.env.INDUK_PASSWORD;

const LAST_NOTICE_FILE = "./last_notice.json";

if (!ID || !PASSWORD) {
  throw new Error("INDUK_ID와 INDUK_PASSWORD 환경변수가 필요합니다.");
}

/**
 * 인덕대학교 포털 로그인
 */
async function login(page) {
  console.log("포털 접속...");

  await page.goto("https://portal.induk.ac.kr/", {
    waitUntil: "domcontentloaded",
  });

  console.log("현재 URL:", page.url());

  const loginId = page.locator('input[name="login_id"]');
  const password = page.locator('input[name="user_password"]');

  if ((await loginId.count()) > 0) {
    console.log("로그인 페이지 발견");

    await loginId.fill(ID);
    await password.fill(PASSWORD);

    await password.press("Enter");

    await page.waitForTimeout(3000);
  }

  console.log("로그인 후 URL:", page.url());

  if (page.url().includes("sso.induk.ac.kr")) {
    throw new Error("로그인에 실패했습니다.");
  }

  console.log("로그인 완료");
}

/**
 * 인덕대학교 공지사항 가져오기
 */
async function getNotices(page) {
  console.log("공지사항 페이지 접속...");

  await page.goto("https://portal.induk.ac.kr/p/BO06", {
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector('ul[data-name="post_list"]');

  console.log("공지사항 URL:", page.url());

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

  return notices;
}

/**
 * 마지막으로 확인한 공지 번호 읽기
 */
function loadLastNoticeNumber() {
  if (!fs.existsSync(LAST_NOTICE_FILE)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(LAST_NOTICE_FILE, "utf-8"));

  return data.lastNoticeNumber;
}

/**
 * 마지막으로 확인한 공지 번호 저장
 */
function saveLastNoticeNumber(number) {
  fs.writeFileSync(
    LAST_NOTICE_FILE,
    JSON.stringify(
      {
        lastNoticeNumber: number,
      },
      null,
      2,
    ),
  );
}

/**
 * 새 공지 찾기
 */
function findNewNotices(notices, lastNoticeNumber) {
  // 숫자 게시물만 대상으로 함
  const normalNotices = notices.filter((notice) => /^\d+$/.test(notice.number));

  // 번호를 숫자로 변환
  const sortedNotices = normalNotices.sort(
    (a, b) => Number(b.number) - Number(a.number),
  );

  // 이전 기록이 없는 최초 실행
  if (lastNoticeNumber === null) {
    return {
      firstRun: true,
      newNotices: [],
      latestNumber:
        sortedNotices.length > 0 ? Number(sortedNotices[0].number) : null,
    };
  }

  // 이전 번호보다 큰 게시물만 새 공지
  const newNotices = sortedNotices.filter(
    (notice) => Number(notice.number) > Number(lastNoticeNumber),
  );

  return {
    firstRun: false,
    newNotices,
    latestNumber:
      sortedNotices.length > 0
        ? Number(sortedNotices[0].number)
        : Number(lastNoticeNumber),
  };
}

/**
 * 프로그램 시작
 */
(async () => {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. 로그인
    await login(page);

    // 2. 공지사항 가져오기
    const notices = await getNotices(page);

    console.log(`공지 ${notices.length}개 확인`);

    // 3. 마지막 확인 번호 읽기
    const lastNoticeNumber = loadLastNoticeNumber();

    console.log("마지막 확인 번호:", lastNoticeNumber ?? "없음");

    // 4. 새 공지 찾기
    const result = findNewNotices(notices, lastNoticeNumber);

    // 5. 최초 실행
    if (result.firstRun) {
      console.log("\n최초 실행입니다.");

      if (result.latestNumber !== null) {
        saveLastNoticeNumber(result.latestNumber);

        console.log(
          `현재 최신 공지 번호 ${result.latestNumber}를 저장했습니다.`,
        );
      }

      console.log("기존 공지는 알림을 보내지 않습니다.");

      return;
    }

    // 6. 새 공지가 없는 경우
    if (result.newNotices.length === 0) {
      console.log("\n새 공지가 없습니다.");
      return;
    }

    // 7. 새 공지가 있는 경우
    console.log(`\n🆕 새 공지 ${result.newNotices.length}개 발견!`);

    for (const notice of result.newNotices) {
      console.log("\n===== 새 공지 =====");
      console.log(`[${notice.number}] ${notice.title}`);
      console.log(`분류: ${notice.category}`);
      console.log(`작성자: ${notice.author}`);
      console.log(`날짜: ${notice.date}`);
      console.log(`URL: ${notice.url}`);
    }

    // 8. 최신 번호 저장
    saveLastNoticeNumber(result.latestNumber);

    console.log(`\n마지막 확인 번호를 ${result.latestNumber}로 저장했습니다.`);
  } catch (error) {
    console.error("오류:", error);
  } finally {
    await browser.close();
  }
})();
