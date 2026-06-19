import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";

import { AuthProvider } from "@/lib/useAuth";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Head>
        <title>CodeSphere</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </AuthProvider>
  );
}
