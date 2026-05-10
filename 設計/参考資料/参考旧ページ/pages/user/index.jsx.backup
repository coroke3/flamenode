import Image from "next/image";
import Head from "next/head";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import Link from "next/link";
import styles from "../../styles/user.module.css";
import { useState } from "react";

// ユーザー情報を取得する関数
const fetchUsersData = async () => {
  const res = await fetch("https://pvsf-cash.vercel.app/api/users", {
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch user data: ${res.statusText}`);
    return [];
  }

  const usersData = await res.json();

  // 重複排除
  const uniqueUsers = {};
  usersData.forEach((user) => {
    if (!uniqueUsers[user.username]) {
      uniqueUsers[user.username] = user;
    }
  });

  return Object.values(uniqueUsers);
};

// アイコンを取得する関数
const fetchUserIcons = async () => {
  const res = await fetch(
    "https://script.google.com/macros/s/AKfycbyEph6zXb1IWFRLpTRLNLtxU4Kj7oe10bt2ifiyK09a6nM13PASsaBYFe9YpDj9OEkKTw/exec"
  );

  if (!res.ok) {
    console.error(`Failed to fetch user icons: ${res.statusText}`);
    return [];
  }

  return await res.json();
};

// 最新の作品を取得する関数
const getLatestWorkByTlink = (icons, tlink) => {
  const tlinkLatestWork = icons.filter(
    (icon) => icon.tlink?.toLowerCase() === tlink.toLowerCase()
  );

  const memberLatestWork = icons.filter(
    (icon) =>
      icon.memberid && icon.memberid.toLowerCase().includes(tlink.toLowerCase())
  );

  // 1. tlinkが一致する作品があり、typeが個人の場合
  const personalWork = tlinkLatestWork.find((icon) => icon.type === "個人");
  if (personalWork) {
    return { creator: personalWork.creator, icon: personalWork.icon };
  }

  // 2. tlinkが一致する作品があるが、typeが個人ではない場合
  if (memberLatestWork.length > 0) {
    const matchedIcon = memberLatestWork.reduce((prev, current) =>
      new Date(prev.date) > new Date(current.date) ? prev : current
    );

    const memberIds = matchedIcon.memberid.split(",");
    const memberNames = matchedIcon.member.split(",");
    const matchedIndex = memberIds.findIndex(
      (id) => id.trim().toLowerCase() === tlink.toLowerCase()
    );

    if (matchedIndex !== -1 && memberNames[matchedIndex] !== undefined) {
      const matchedMemberName = memberNames[matchedIndex].trim();
      const latestIcon =
        tlinkLatestWork.length > 0
          ? tlinkLatestWork.reduce((prev, current) =>
            new Date(prev.date) > new Date(current.date) ? prev : current
          ).icon
          : matchedIcon.icon;

      return { creator: matchedMemberName, icon: latestIcon };
    }
  } else {
    const personalWork = tlinkLatestWork[0];

    if (personalWork) {
      return { creator: personalWork.creator, icon: personalWork.icon };
    }
  }

  // 3. tlinkが一致しない場合
  if (memberLatestWork.length > 0) {
    const matchedIcon = memberLatestWork.reduce((prev, current) =>
      new Date(prev.date) > new Date(current.date) ? prev : current
    );

    const memberIds = matchedIcon.memberid.split(",");
    const memberNames = matchedIcon.member.split(",");
    const matchedIndex = memberIds.findIndex(
      (id) => id.trim().toLowerCase() === tlink.toLowerCase()
    );

    if (matchedIndex !== -1) {
      // Check if memberNames[matchedIndex] is defined and is a string
      const matchedMemberName =
        typeof memberNames[matchedIndex] === "string"
          ? memberNames[matchedIndex].trim()
          : null;
      return { creator: matchedMemberName, icon: null }; // アイコンは取得しない
    }
  }

  // 4. すべての条件に合致しない場合
  // tlinkLatestWorkが空の場合は、アイコンとcreatorを取得するロジック
  if (tlinkLatestWork.length === 0) {
    // アイコンは取得しないので、creatorはnullを返す
    return { creator: null, icon: null };
  }

  return null;
};

export default function UserPage({ users = [] }) {
  const [sortOption, setSortOption] = useState("totalWorks");

  // ソート処理
  const sortedUsers = [...users].sort((a, b) => {
    if (sortOption === "name") {
      const aCreatorName = a.creatorName || "不明";
      const bCreatorName = b.creatorName || "不明";
      return aCreatorName.localeCompare(bCreatorName);
    }
    if (sortOption === "totalWorks") {
      const aTotalWorks = (a.iylink?.length || 0) + (a.cylink?.length || 0);
      const bTotalWorks = (b.iylink?.length || 0) + (b.cylink?.length || 0);
      return bTotalWorks - aTotalWorks; // 合計作品数の降順
    }
    if (sortOption === "latestWork") {
      // 最新作品順は新しいAPIでは実装困難なため、現在は作品数順にフォールバック
      const aTotalWorks = (a.iylink?.length || 0) + (a.cylink?.length || 0);
      const bTotalWorks = (b.iylink?.length || 0) + (b.cylink?.length || 0);
      return bTotalWorks - aTotalWorks;
    }
    return 0;
  });

  return (
    <div>
      <Head>
        <title>ユーザー一覧 - EventArchives</title>
        <meta
          name="description"
          content="ユーザーの名前とアイコンの一覧です。"
        />
      </Head>
      <div className="content">
        <h1 className="entitle">CREATOR</h1>
        <h1 className="jatitle">クリエイター一覧</h1>
        <select className={styles.select}
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value)}
        >
          <option value="name">名前順</option>
          <option value="totalWorks">合計作品数順</option>
          <option value="latestWork">最新の作品順</option>
        </select>
        <div className={styles.userlist}>
          {sortedUsers.length > 0 ? (
            sortedUsers.map((user) => {
              const creatorName = user.creatorName || "不明";
              const individualWorks = user.iylink?.length || 0;
              const collaborationWorks = user.cylink?.length || 0;
              const totalWorks = individualWorks + collaborationWorks;

              return (
                <div className={styles.users} key={user.username}>
                  <Link href={`/user/${user.username}`} passHref>
                    <div className={styles.userbox}>
                      {user.icon ? (
                        <Image
                          src={`https://lh3.googleusercontent.com/d/${user.icon.slice(33)}`}
                          className={styles.iconuse}
                          alt={`${user.username}のアイコン`}
                          width={50}
                          height={50}
                        />
                      ) : (
                        <Image
                          src="https://i.gyazo.com/07a85b996890313b80971d8d2dbf4a4c.jpg"
                          alt={`アイコン`}
                          className={styles.iconuse}
                          width={50}
                          height={50}
                        />
                      )}
                      <div className={styles.namebox}>
                        <h4>{creatorName}</h4>
                        <p className="id">@{user.username}</p>
                      </div>
                    </div>
                    <div className={styles.countb}>
                      <div className={styles.counts}>
                        <p>個人 {individualWorks}</p>
                      </div>
                      <div className={styles.counts}>
                        <p>合作 {collaborationWorks}</p>
                      </div>
                      <div className={styles.counts}>
                        <p>合計 {totalWorks}</p>
                      </div>
                    </div>
                  </Link>
                </div>
              );
            })
          ) : (
            <p>ユーザーが見つかりませんでした。</p>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}

export const getStaticProps = async () => {
  const users = await fetchUsersData();
  return {
    props: {
      users,
    },
  };
};
