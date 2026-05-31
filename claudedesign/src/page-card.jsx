// Event recruitment card showcase page — all 4 statuses

function CardShowcase({ lang }) {
  const event = window.FN_EVENTS[0]; // PVSF2025S
  const statuses = [
    { id: "pre",    title: "Pre-open",    jp: "募集前",     desc: "募集開始前。トーンを落とし、CTA は二次的に。" },
    { id: "entry",  title: "Entry open",  jp: "募集中",     desc: "メインステート。ライムアクセントで行動を促す。" },
    { id: "submit", title: "Submission",  jp: "投稿期間中", desc: "提出ウィンドウが現在地に重なる。締切までのカウントダウン。" },
    { id: "ended",  title: "Ended",       jp: "終了",       desc: "終了状態。色を抜き、アーカイブ動線へ橋渡し。" },
  ];
  return (
    <main className="fn-main" data-screen-label="CardShowcase">
      <div className="fn-wrap">
        <header className="fn-cs-head">
          <span className="fn-eyebrow">specimen — 募集カードの4ステート</span>
          <h1 className="fn-display fn-cs-title">Event recruitment card</h1>
          <p className="fn-cs-desc fn-jp">
            元のラフをベースに、募集前 / 募集中 / 投稿期間中 / 終了 の4ステートを統一規格で再構築。
            タイムラインは定規（ruler）モチーフを軸に、月境界・週ティック・日ティック・現在地マーカー・投稿ウィンドウを描き分け。
            右側の残日数はディスプレイ書体で大きく、補助情報は等幅で添える。
          </p>
        </header>

        <div className="fn-cs-grid">
          {statuses.map(s => (
            <section key={s.id} className="fn-cs-cell">
              <div className="fn-cs-cell-head">
                <h2 className="fn-display fn-cs-cell-title">{s.title}<span className="fn-jp fn-cs-cell-jp"> — {s.jp}</span></h2>
                <p className="fn-cs-cell-desc">{s.desc}</p>
              </div>
              <EventRecruitmentCard event={event} lang={lang} forceStatus={s.id} />
            </section>
          ))}
        </div>

        {/* Spec block */}
        <section className="fn-cs-spec">
          <h2 className="fn-display fn-cs-spec-title">構造メモ</h2>
          <table className="fn-cs-spec-tbl">
            <thead>
              <tr><th>Field</th><th>Token</th><th>Note</th></tr>
            </thead>
            <tbody>
              <tr><td>ステート色</td><td className="fn-mono">--rec-accent</td><td>状態に応じて lime / muted / faint を切替</td></tr>
              <tr><td>定規ウィンドウ</td><td className="fn-mono">submit / entry</td><td>提出期間は塗り、募集期間はダッシュ枠で表現</td></tr>
              <tr><td>現在地マーカー</td><td className="fn-mono">dot + ▲</td><td>現在地を上の丸＋下の三角で明示。色は状態に追従</td></tr>
              <tr><td>カウンター</td><td className="fn-mono">--font-display</td><td>残日数は大型ディスプレイ書体。単位「日」と補助ラベルを縦に添える</td></tr>
              <tr><td>フッター指標</td><td className="fn-mono">--font-mono</td><td>entries / creators / slots / event を等幅で並列</td></tr>
              <tr><td>角丸</td><td className="fn-mono">--r-block</td><td>Editorial=14 / Node=4 / Frame=24</td></tr>
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

Object.assign(window, { CardShowcase });
