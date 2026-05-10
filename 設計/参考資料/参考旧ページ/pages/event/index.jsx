import Image from "next/image";
import Head from "next/head";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import Link from "next/link"; // Link コンポーネントをインポート
import styles from "../../styles/mainevents.module.css";

// 日付フォーマット関数を追加
const formatDate = (dateStr) => {
  const date = new Date(dateStr);

  // 15時間を加算
  date.setHours(date.getHours() + 15);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // 月は0始まりなので+1
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

// イベント情報を取得する関数
const fetchEventsData = async () => {
  try {
    const res = await fetch(
      "https://script.google.com/macros/s/AKfycbybjT6iEZWbfCIzTvU1ALVxp1sa_zS_pGJh5_p_SBsJgLtmzcmqsIDRtFkJ9B8Yko6tyA/exec"
    );

    if (!res.ok) {
      console.error(`Failed to fetch event data: ${res.statusText}`);
      return [];
    }

    return await res.json();
  } catch (error) {
    console.error("Error fetching events:", error);
    return [];
  }
};

export default function EventPage({ events = [] }) {
  return (
    <div>
      <Head>
        <title>イベント一覧 - EventArchives</title>
        <meta name="description" content="イベントの一覧です。" />
      </Head>
      <div className={styles.levent}>
        <h1 className="entitle">EVENT</h1>
        <h1 className="jatitle">イベント一覧</h1>
        <div className={styles.eventList}>
          {events.length > 0 ? (
            events.map((event) => (
              <div key={event.eventid} className={styles.eventItem}>
                {event.img ? (
                  <Link href={`/event/${event.eventid}`} passHref>
                    <Image
                      src={event.img}
                      alt={`${event.eventname} サムネ`}
                      width={1280}
                      height={720}
                      className={styles.samune}
                    />
                  </Link>
                ) : null}
                <div className={styles.eventtitle}>
                  {event.icon ? (
                    <Image
                      src={`https://lh3.googleusercontent.com/d/${event.icon.slice(
                        33
                      )}`}
                      alt={`${event.eventname}のアイコン`}
                      width={50}
                      height={50}
                      className={styles.icon}
                    />
                  ) : (
                    <Image
                      src="https://i.gyazo.com/07a85b996890313b80971d8d2dbf4a4c.jpg"
                      alt={`デフォルトアイコン`}
                      width={50}
                      height={50}
                      className={styles.icon}
                    />
                  )}
                  <h3>{event.eventname}</h3>
                </div>
                {event.start && event.end ? (
                  <p>
                    開催期間: {formatDate(event.start)} 〜{" "}
                    {formatDate(event.end)}
                  </p>
                ) : (
                  <p>開催日: {formatDate(event.start)}</p>
                )}

                <Link href={`/event/${event.eventid}`} passHref>
                  <p className={styles.details}>詳細を見る</p>
                </Link>
              </div>
            ))
          ) : (
            <p>イベントが見つかりませんでした。</p>
          )}
        </div>
      </div>
    </div>
  );
}

// 静的にプロパティを取得
export const getStaticProps = async () => {
  const events = await fetchEventsData(); // イベントデータを取得

  return {
    props: {
      events, // 取得したイベントデータをpropsに渡す
    },
  };
};
