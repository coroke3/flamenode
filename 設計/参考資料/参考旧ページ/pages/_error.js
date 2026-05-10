import Head from "next/head";
import Link from "next/link";
import Header from "../components/Header";
import Footer from "../components/Footer";

function Error({ statusCode }) {
  return (
    <>
      <Head>
        <title>
          {statusCode
            ? `${statusCode} - エラーが発生しました`
            : "エラーが発生しました"} | EventArchives
        </title>
        <meta name="description" content="エラーが発生しました。" />
      </Head>
      <Header />
      <div style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center"
      }}>
        <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>
          {statusCode || "エラー"}
        </h1>
        <p style={{ fontSize: "1.2rem", marginBottom: "2rem", color: "var(--text-secondary)" }}>
          {statusCode === 404
            ? "ページが見つかりませんでした"
            : statusCode === 500
              ? "サーバーエラーが発生しました"
              : "予期しないエラーが発生しました"}
        </p>
        <Link href="/" style={{
          padding: "0.75rem 1.5rem",
          backgroundColor: "var(--primary-color, #0070f3)",
          color: "white",
          textDecoration: "none",
          borderRadius: "8px",
          fontWeight: "600"
        }}>
          ホームに戻る
        </Link>
      </div>
      <Footer />
    </>
  );
}

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;

