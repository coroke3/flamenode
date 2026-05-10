import Head from "next/head";
import Link from "next/link";
import Header from "../components/Header";
import Footer from "../components/Footer";

export default function Custom404() {
  return (
    <>
      <Head>
        <title>404 - ページが見つかりません | EventArchives</title>
        <meta name="description" content="指定されたページが見つかりませんでした。" />
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
        <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>404</h1>
        <p style={{ fontSize: "1.2rem", marginBottom: "2rem", color: "var(--text-secondary)" }}>
          ページが見つかりませんでした
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

