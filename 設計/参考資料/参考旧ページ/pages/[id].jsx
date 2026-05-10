import React, { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import Head from "next/head";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXTwitter,
  faYoutube,
} from "@fortawesome/free-brands-svg-icons";
import { faUser } from '@fortawesome/free-solid-svg-icons';
import styles from "../styles/work.module.css";
import { loadBuildData } from "../lib/buildData";

// メモ化されたコンポーネント（Cloudflare Pages対応）
const WorkCard = React.memo(function WorkCard({ work }) {
  return (
    <div className={styles.ss1} key={work.ylink.slice(17, 28)}>
      <div className={styles.ss12}>
        <Link href={`/${work.ylink.slice(17, 28)}`}>
          <img
            src={work.smallThumbnail}
            width="100%"
            alt={`${work.title} - ${work.creator} | PVSF archive`}
            loading="lazy"
          />
        </Link>
      </div>
      <div className={styles.ss13}>
        <p className={styles.scc}>{work.title}</p>
        <p className={styles.sc}>{work.creator}</p>
      </div>
    </div>
  );
});

// メモ化されたユーザーアイコンコンポーネント
const UserIcon = React.memo(function UserIcon({ work }) {
  return (
    <Link href={`../user/${work.tlink?.toLowerCase() || ""}`}>
      <Image
        src={work.icon ?
          `https://lh3.googleusercontent.com/d/${work.icon.slice(33)}` :
          "https://i.gyazo.com/07a85b996890313b80971d8d2dbf4a4c.jpg"
        }
        className={styles.icon}
        alt={`${work.creator || ""}のアイコン`}
        width={50}
        height={50}
      />
    </Link>
  );
});

// メモ化されたメンバーテーブル行コンポーネント
const MemberTableRow = React.memo(function MemberTableRow({ username, memberId, matchedUser, index }) {
  return (
    <tr>
      <td>{index + 1}</td>
      <td>{username.trim()}</td>
      <td className={styles.userlink}>
        {matchedUser ? (
          <>
            {matchedUser.icon ? (
              <Link href={`/user/${matchedUser.username}`} className={styles.userLink}>
                <Image
                  src={`https://lh3.googleusercontent.com/d/${matchedUser.icon.slice(33)}`}
                  alt={`${matchedUser.username}のアイコン`}
                  width={50}
                  height={50}
                  className={styles.icon}
                />
              </Link>
            ) : (
              <Link href={`/user/${matchedUser.username}`} className={styles.userLink}>
                <FontAwesomeIcon icon={faUser} />
              </Link>
            )}
            <div className={styles.userlis}>
              <Link href={`/user/${matchedUser.username}`} className={styles.userLink}>
                /{matchedUser.username}
              </Link>
            </div>
          </>
        ) : memberId ? (
          <div className={styles.userlis}>@{memberId}</div>
        ) : (
          "-"
        )}
      </td>
      <td>
        {memberId ? (
          <a href={`https://twitter.com/${memberId}`} target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faXTwitter} className={styles.twitterIcon} />
          </a>
        ) : (
          "-"
        )}
      </td>
    </tr>
  );
});

// メモ化されたイベントナビゲーションアイテムコンポーネント
const EventNavItem = React.memo(function EventNavItem({ work, label }) {
  if (!work) return null;

  return (
    <Link href={`/${work.ylink.slice(17, 28)}`} className={styles.eventNavItem}>
      <div className={styles.eventNavThumb}>
        <img
          src={work.smallThumbnail}
          alt={`${label}: ${work.title}`}
          width={160}
          height={90}
        />
      </div>
      <div className={styles.eventNavInfo}>
        <span className={styles.eventNavLabel}>{label}</span>
        <span className={styles.eventNavTitle}>{work.title}</span>
      </div>
    </Link>
  );
});

// メモ化されたイベントカードコンポーネント
const EventCard = React.memo(function EventCard({ event, eventWorks, index }) {
  return (
    <div className={styles.eventSection}>
      <div className={styles.eventCard}>
        {event.icon && (
          <Link href={`../../event/${event.eventid}`}>
            <Image
              src={`https://lh3.googleusercontent.com/d/${event.icon.slice(33)}`}
              alt={`${event.eventname}のアイコン`}
              className={styles.eventIcon}
              width={40}
              height={40}
            />
          </Link>
        )}
        <div className={styles.eventDetails}>
          <Link href={`../../event/${event.eventid}`}>
            <h4 className={styles.eventTitle}>{event.eventname}</h4>
            {event.explanation && (
              <p className={styles.eventExplanation}>{event.explanation}</p>
            )}
          </Link>
        </div>
      </div>

      {/* イベント内の前後作品 */}
      <div className={styles.eventNavigation}>
        <EventNavItem work={eventWorks[index]?.prevWork} label="前の作品" />
        <EventNavItem work={eventWorks[index]?.nextWork} label="次の作品" />
      </div>
    </div>
  );
});

// メモ化された楽曲表示コンポーネント
const MusicDisplay = React.memo(function MusicDisplay({ work }) {
  if (!work.music || typeof work.music !== 'string') return null;

  return (
    <p
      dangerouslySetInnerHTML={{
        __html: `楽曲:${work.music} - ${work.credit}<br> `,
      }}
    />
  );
});

// メモ化されたクリエイター情報コンポーネント
const CreatorInfo = React.memo(function CreatorInfo({ work, workDetails }) {
  return (
    <div className={styles.userinfo}>
      {workDetails.showIcon ? (
        <Link href={`../user/${work.tlink?.toLowerCase() || ""}`}>
          <Image
            src={work?.icon
              ? `https://lh3.googleusercontent.com/d/${work.icon.slice(33)}`
              : "https://i.gyazo.com/07a85b996890313b80971d8d2dbf4a4c.jpg"
            }
            className={styles.icon}
            alt={`${work.creator}のアイコン`}
            width={50}
            height={50}
          />
        </Link>
      ) : (
        <Link href={`../user/${work.tlink?.toLowerCase() || ""}`}>
          <Image
            src="https://i.gyazo.com/07a85b996890313b80971d8d2dbf4a4c.jpg"
            alt="アイコン"
            className={styles.icon}
            width={50}
            height={50}
          />
        </Link>
      )}

      {workDetails.showCreator && (
        <h3 className={styles.creator}>
          <Link href={`../user/${work.tlink?.toLowerCase() || ""}`}>
            {work.creator}{" "}
          </Link>
          {workDetails.showYoutube && (
            <a
              href={`${work.ylink}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FontAwesomeIcon icon={faYoutube} />
            </a>
          )}
          {workDetails.showTwitter && (
            <a
              href={`https://twitter.com/${work.tlink}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FontAwesomeIcon icon={faXTwitter} />
            </a>
          )}
        </h3>
      )}
      {workDetails.showTime && (
        <p className={styles.time}>{new Intl.DateTimeFormat('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(new Date(new Date(work.time).getTime() - 9 * 60 * 60 * 1000))}</p>
      )}
    </div>
  );
});

export default function WorkId({
  work,
  previousWorks,
  nextWorks,
  icon,
  eventname,
  externalData,
  auth = { auth: false, user: null },
  events,
  videos,
}) {
  // workDetailsをuseMemoで最適化
  const workDetails = useMemo(() => {
    if (!work) return {};
    const safe = (v) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.join(', ').trim() : '') !== "";

    return {
      showComment: safe(work.comment),
      showIcon: safe(work.icon),
      showCreator: safe(work.creator),
      showTwitter: safe(work.tlink),
      showYoutube: safe(work.ylink),
      showMember: safe(work.member), // memberidの条件を削除
      showMusic: safe(work.music),
      showMusicLink: safe(work.ymulink),
      showTime: safe(work.time),
    };
  }, [work]);

  // メタデータをuseMemoで最適化
  const metaData = useMemo(() => ({
    title: `${work?.title || '作品'} - ${work?.creator || 'クリエイター'} - EventArchives`,
    description: `PVSFへの出展作品です。  ${work?.title || '作品'} - ${work?.creator || 'クリエイター'}`,
    ogDescription: `EventArchives  ${work?.title || '作品'} - ${work?.creator || 'クリエイター'}  music:${work?.music || ''} - ${work?.credit || ''}`,
  }), [work]);

  // YouTube URL
  const youtubeEmbedUrl = useMemo(() =>
    work?.ylink ? `https://www.youtube.com/embed/${work.ylink.slice(17, 28)}?vq=hd1080&autoplay=1` : null,
    [work?.ylink]
  );

  // 現在の作品のアナリティクス情報（Cloudflare Pages対応版）
  const currentWorkAnalytics = useMemo(() => {
    if (!work?.ylink || typeof window === 'undefined') return null;

    // 開発環境のみモックデータを生成
    if (process.env.NODE_ENV === 'development') {
      const baseScore = work.videoScore || 50;
      const multiplier = Math.max(0.2, (baseScore / 150)); // 0.2-0.7の範囲
      return {
        pageViews: Math.floor(8 + multiplier * 35 + Math.random() * 25), // 8-68の範囲
        sessions: Math.floor(5 + multiplier * 20 + Math.random() * 15), // 5-40の範囲  
        avgDuration: Math.floor(60 + Math.random() * 200) // 60-260秒
      };
    }

    return null; // 本番環境では非表示
  }, [work?.ylink, work?.videoScore]);

  // メンバー情報の処理を最適化
  const memberInfo = useMemo(() => {
    if (!work?.member || !workDetails.showMember) return [];
    return work.member.split(/[,、，]/).map((username, index) => {
      // memberidが存在する場合のみ取得、存在しない場合はundefined
      const memberId = work.memberid ?
        work.memberid.split(/[,、，]/)[index]?.trim() :
        undefined;

      // memberIdが存在する場合のみユーザー検索
      const matchedUser = memberId ?
        externalData.find(user => user.username.toLowerCase() === memberId.toLowerCase()) :
        null;

      return { username, memberId, matchedUser };
    });
  }, [work?.member, work?.memberid, externalData, workDetails.showMember]);

  // イベント情報の処理を最適化
  const eventInfo = useMemo(() => {
    if (!work?.eventid || !events) return [];

    return work.eventid.split(',').map(eventId => {
      const trimmedEventId = eventId.trim();
      const matchedEvent = events.find(e => e.eventid === trimmedEventId);

      return matchedEvent ? {
        eventid: trimmedEventId,
        eventname: matchedEvent.eventname,
        explanation: matchedEvent.explanation,
        icon: matchedEvent.icon
      } : {
        eventid: trimmedEventId,
        eventname: trimmedEventId,
        explanation: "",
        icon: ""
      };
    });
  }, [work?.eventid, events]);

  // イベント内の前後作品情報の処理を追加
  const eventWorks = useMemo(() => {
    if (!work?.eventid || !videos) return [];

    // 各イベントIDに対して前後の作品を取得
    return work.eventid.split(',').map(eventId => {
      const trimmedEventId = eventId.trim();

      // イベントに属する全作品を取得し、時系列順にソート
      const eventVideos = videos
        .filter(v => v.eventid?.split(',').some(e => e.trim() === trimmedEventId))
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      // 現在の作品のインデックスを取得
      const currentIndex = eventVideos.findIndex(v => v.ylink === work.ylink);

      // 前後の作品を探す
      let prevWork = null;
      let nextWork = null;

      if (currentIndex !== -1) {
        // 前の作品を探す
        for (let i = currentIndex - 1; i >= 0; i--) {
          if (eventVideos[i]) {
            prevWork = eventVideos[i];
            break;
          }
        }

        // 次の作品を探す
        for (let i = currentIndex + 1; i < eventVideos.length; i++) {
          if (eventVideos[i]) {
            nextWork = eventVideos[i];
            break;
          }
        }
      }

      return {
        eventId: trimmedEventId,
        prevWork,
        nextWork
      };
    });
  }, [work?.eventid, work?.ylink, videos]);

  // workが存在しない場合の早期リターン
  if (!work) {
    return (
      <div>
        <Head>
          <title>作品が見つかりません - EventArchives</title>
          <meta name="description" content="指定された作品が見つかりませんでした。" />
        </Head>
        <div className={styles.contentr}>
          <h1>作品が見つかりません</h1>
          <p>指定された作品が見つかりませんでした。</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Head>
        <title>{metaData.title}</title>
        <meta
          name="description"
          content={metaData.description}
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@pvscreeningfes" />
        <meta name="twitter:creator" content="@coroke3" />
        <meta property="og:url" content="event" />
        <meta
          property="og:title"
          content={metaData.title}
        />
        <meta
          property="og:description"
          content={metaData.ogDescription}
        />
        <meta property="og:image" content={work?.largeThumbnail || ""} />
      </Head>

      <div className={styles.contentr}>
        <div className={styles.bf}>
          <div className={styles.s1f}>
            {work?.ylink && youtubeEmbedUrl && (
              <iframe
                src={youtubeEmbedUrl}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className={styles.yf}
              ></iframe>
            )}
            <div className={styles.s1ftext}>
              <h1 className={styles.title}>{work?.title || '作品名不明'}</h1>
              {currentWorkAnalytics && (
                <div className={styles.analyticsCompact}>
                  <span className={styles.analyticsMetric}>
                    <span className={styles.analyticsNumber}>{currentWorkAnalytics.pageViews.toLocaleString()}</span>
                    <span className={styles.analyticsUnit}>views</span>
                  </span>
                  <span className={styles.analyticsDivider}>•</span>
                  <span className={styles.analyticsMetric}>
                    <span className={styles.analyticsNumber}>{currentWorkAnalytics.sessions.toLocaleString()}</span>
                    <span className={styles.analyticsUnit}>sessions</span>
                  </span>
                  <span className={styles.analyticsDivider}>•</span>
                  <span className={styles.analyticsMetric}>
                    <span className={styles.analyticsNumber}>{Math.round(currentWorkAnalytics.avgDuration)}</span>
                    <span className={styles.analyticsUnit}>sec avg</span>
                  </span>
                </div>
              )}
              <CreatorInfo work={work} workDetails={workDetails} />
              <div className={styles.eventInfo}>
                {eventInfo.map((event, index) => (
                  <EventCard key={index} event={event} eventWorks={eventWorks} index={index} />
                ))}
              </div>

              {workDetails.showMusic && (
                <MusicDisplay work={work} />
              )}
              {workDetails.showMusicLink && (
                <p>
                  <Link href={work?.ymulink || "#"}>楽曲リンク＞</Link>
                </p>
              )}
              {workDetails.showComment && (
                <p>
                  <div
                    dangerouslySetInnerHTML={{ __html: `${work?.comment || ""}` }}
                  />
                </p>
              )}
              {workDetails.showMember && work?.member && (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Name</th>
                      <th>ID</th>
                      <th>LINK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberInfo.map(({ username, memberId, matchedUser }, index) => (
                      <MemberTableRow
                        key={index}
                        username={username}
                        memberId={memberId}
                        matchedUser={matchedUser}
                        index={index}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className={styles.s2f}>
            {previousWorks.map((prevWork) => (
              <WorkCard key={prevWork.ylink.slice(17, 28)} work={prevWork} />
            ))}
            {nextWorks.map((nextWork) => (
              <WorkCard key={nextWork.ylink.slice(17, 28)} work={nextWork} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
// イベントデータを取得する関数
async function fetchEventData(eventId) {
  const eventRes = await fetch(
    `https://script.google.com/macros/s/AKfycbybjT6iEZWbfCIzTvU1ALVxp1sa_zS_pGJh5_p_SBsJgLtmzcmqsIDRtFkJ9B8Yko6tyA/exec?eventid=${eventId}`
  );

  if (!eventRes.ok) {
    throw new Error("イベント情報の取得に失敗しました");
  }

  const eventData = await eventRes.json();
  const eventInfo = eventData.find((event) => event.eventid === eventId);

  return {
    eventname: eventInfo?.eventname || "Unknown Event",
    icon: eventInfo?.icon || "",
  };
}

// getRelatedWorks関数を修正（Cloudflare Pages対応）
function getRelatedWorks(work, publicData, currentIndex) {
  const safeCompare = (a, b) => a && b && typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

  const uniqueWorks = (works) => Array.from(new Set(works.map(w => w.ylink))).map(ylink => works.find(w => w.ylink === ylink));

  // 人気度を考慮したソート関数（Cloudflare Pages対応）
  const sortByPopularity = (works) => {
    return works.sort((a, b) => {
      const scoreA = (a.videoScore || 0);
      const scoreB = (b.videoScore || 0);
      return scoreB - scoreA;
    });
  };

  const getRandomWorks = (works, count) => works.length <= count ? works : works.sort(() => 0.5 - Math.random()).slice(0, count);

  const baseFilter = w => w.ylink !== work.ylink;
  const memberIds = work.memberid?.split(',').map(id => id.trim()).filter(Boolean) || [];
  const workTime = new Date(work.time);
  const worksPerUser = publicData.length <= 25 ? 2 : 1;

  const categorizedWorks = publicData.reduce((acc, w) => {
    if (!baseFilter(w)) return acc;

    if (w.tlink === work.tlink) {
      acc.tlinkWorks.push(w);
    }

    if (w.memberid?.split(',').map(id => id.trim()).includes(work.tlink)) {
      acc.memberidWorks.push({
        ...w,
        timeDiff: Math.abs(new Date(w.time) - workTime)
      });
    }

    if (memberIds.some(id => w.tlink === id)) {
      acc.memberTlinkWorks.push(w);
    } else if (memberIds.some(id => w.memberid?.includes(id)) && w.tlink !== work.tlink) {
      acc.memberRelatedWorks.push(w);
    }

    if (safeCompare(w.music, work.music)) {
      acc.musicWorks.push(w);
    }
    if (safeCompare(w.credit, work.credit)) {
      acc.creditWorks.push(w);
    }

    if (w.deterministicScore) {
      acc.scoreWorks.push(w);
    }

    return acc;
  }, {
    tlinkWorks: [],
    memberidWorks: [],
    memberTlinkWorks: [],
    memberRelatedWorks: [],
    musicWorks: [],
    creditWorks: [],
    scoreWorks: []
  });

  const isPrivate = work.status === "private";
  const processedWorks = {
    tlinkWorks: isPrivate
      ? sortByPopularity(categorizedWorks.tlinkWorks)
        .slice(0, 4)
      : sortByPopularity(categorizedWorks.tlinkWorks)
        .slice(0, 3),

    memberidWorks: sortByPopularity(categorizedWorks.memberidWorks)
      .slice(0, 2),

    surroundingWorks: isPrivate ? [] : [
      ...publicData.slice(Math.max(0, currentIndex - 3), currentIndex),
      ...publicData.slice(currentIndex + 1, currentIndex + 4)
    ],

    memberTlinkWorks: sortByPopularity(categorizedWorks.memberTlinkWorks)
      .slice(0, worksPerUser * memberIds.length),
    memberRelatedWorks: sortByPopularity(categorizedWorks.memberRelatedWorks)
      .slice(0, worksPerUser * memberIds.length),

    musicWorks: sortByPopularity(categorizedWorks.musicWorks)
      .slice(0, isPrivate ? 2 : 3),
    creditWorks: sortByPopularity(categorizedWorks.creditWorks)
      .slice(0, isPrivate ? 2 : 3),

    randomWorks: sortByPopularity(publicData.filter(baseFilter))
      .slice(0, 2),

    scoreWorks: sortByPopularity(
      categorizedWorks.scoreWorks
        .sort((a, b) => b.deterministicScore - a.deterministicScore)
        .slice(0, 50)
    ).slice(0, 2)
  };

  const uniqueAllWorks = uniqueWorks([
    ...processedWorks.tlinkWorks,
    ...processedWorks.memberidWorks,
    ...processedWorks.surroundingWorks,
    ...processedWorks.memberTlinkWorks,
    ...processedWorks.memberRelatedWorks,
    ...processedWorks.musicWorks,
    ...processedWorks.creditWorks,
    ...processedWorks.randomWorks,
    ...processedWorks.scoreWorks
  ]);

  const midPoint = Math.floor(uniqueAllWorks.length / 2);
  return {
    previousWorks: uniqueAllWorks.slice(0, midPoint),
    nextWorks: uniqueAllWorks.slice(midPoint)
  };
}

// getStaticPropsの修正
export async function getStaticProps({ params }) {
  try {
    const cachedData = loadBuildData();
    if (cachedData) {
      const videosData = Array.isArray(cachedData.videos) ? cachedData.videos : [];
      const usersData = Array.isArray(cachedData.users) ? cachedData.users : [];
      const eventsData = Array.isArray(cachedData.events) ? cachedData.events : [];

      if (!Array.isArray(videosData) || videosData.length === 0) {
        return { notFound: true };
      }

      const publicData = videosData.filter(w => w.status !== "private");
      const work = videosData.find(w => w.ylink.slice(17, 28) === params.id);

      if (!work) {
        return { notFound: true };
      }

      const currentIndex = publicData.findIndex(w => w.ylink.slice(17, 28) === params.id);
      const { previousWorks, nextWorks } = getRelatedWorks(work, publicData, currentIndex);

      return {
        props: {
          work,
          externalData: usersData || [],
          previousWorks: previousWorks || [],
          nextWorks: nextWorks || [],
          events: eventsData || [],
          videos: videosData
        }
      };
    }

    const fetchWithRetry = async (url, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          const res = await fetch(url, {
            signal: controller.signal,
            headers: {
              'Cache-Control': 'public, max-age=3600',
              'User-Agent': 'Mozilla/5.0 (compatible; PVSF-Archive/1.0)'
            }
          });

          clearTimeout(timeoutId);

          if (res.ok) {
            const text = await res.text();
            if (!text || text.trim() === '') {
              throw new Error('Empty response');
            }
            return JSON.parse(text);
          }
        } catch (err) {
          if (i === retries - 1) throw err;
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      }
      return null;
    };

    const [videos, users, events] = await Promise.allSettled([
      fetchWithRetry("https://pvsf-cash.vercel.app/api/videos"),
      fetchWithRetry("https://pvsf-cash.vercel.app/api/users"),
      fetchWithRetry("https://script.google.com/macros/s/AKfycbybjT6iEZWbfCIzTvU1ALVxp1sa_zS_pGJh5_p_SBsJgLtmzcmqsIDRtFkJ9B8Yko6tyA/exec")
    ]);

    // 結果を安全に処理
    const videosData = videos.status === 'fulfilled' ? videos.value : [];
    const usersData = users.status === 'fulfilled' ? users.value : [];
    const eventsData = events.status === 'fulfilled' ? events.value : [];

    if (!Array.isArray(videosData) || videosData.length === 0) {
      console.error('Failed to fetch videos data or data is empty');
      return { notFound: true };
    }

    const publicData = videosData.filter(w => w.status !== "private");
    const work = videosData.find(w => w.ylink.slice(17, 28) === params.id);

    if (!work) {
      console.error(`Work not found for ID: ${params.id}`);
      return { notFound: true };
    }

    const currentIndex = publicData.findIndex(w => w.ylink.slice(17, 28) === params.id);
    const { previousWorks, nextWorks } = getRelatedWorks(work, publicData, currentIndex);

    return {
      props: {
        work,
        externalData: usersData || [],
        previousWorks: previousWorks || [],
        nextWorks: nextWorks || [],
        events: eventsData || [],
        videos: videosData
      }
    };

  } catch (error) {
    console.error(`Error in getStaticProps for ID ${params.id}:`, error);
    return { notFound: true };
  }
}

// getStaticPathsの修正
export async function getStaticPaths() {
  try {
    const cachedData = loadBuildData();
    if (cachedData?.videos && Array.isArray(cachedData.videos)) {
      const uniquePaths = new Set();
      const paths = cachedData.videos
        .filter(work => {
          if (!work || !work.ylink) return false;
          const id = work.ylink.slice(17, 28);
          if (uniquePaths.has(id)) return false;
          uniquePaths.add(id);
          return true;
        })
        .map(work => ({ params: { id: work.ylink.slice(17, 28) } }));
      return { paths, fallback: false };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch("https://pvsf-cash.vercel.app/api/videos", {
      signal: controller.signal,
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'User-Agent': 'Mozilla/5.0 (compatible; PVSF-Archive/1.0)'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error(`Failed to fetch videos: ${res.status} ${res.statusText}`);
      return { paths: [], fallback: false };
    }

    const text = await res.text();
    if (!text || text.trim() === '') {
      console.error('Empty response from videos API');
      return { paths: [], fallback: false };
    }

    let works;
    try {
      works = JSON.parse(text);
    } catch (parseError) {
      console.error('JSON Parse Error in getStaticPaths:', parseError.message);
      return { paths: [], fallback: false };
    }

    if (!Array.isArray(works)) {
      console.error('Works data is not an array in getStaticPaths');
      return { paths: [], fallback: false };
    }

    const uniquePaths = new Set();
    const paths = works
      .filter(work => {
        try {
          if (!work || !work.ylink) return false;

          const id = work.ylink.slice(17, 28);
          if (uniquePaths.has(id)) return false;

          uniquePaths.add(id);
          return true;
        } catch (e) {
          console.error(`Invalid work data:`, work);
          return false;
        }
      })
      .map(work => ({ params: { id: work.ylink.slice(17, 28) } }));

    console.log(`Generated ${paths.length} unique static paths out of ${works.length} works`);
    return { paths, fallback: false };

  } catch (error) {
    console.error('Error in getStaticPaths:', error);
    return { paths: [], fallback: false };
  }
}
