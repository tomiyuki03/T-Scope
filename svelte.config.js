import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
// GitHub Pages の公開先のパス（https://<user>.github.io/<リポジトリ名>/）。環境変数 BASE_PATH で上書きできる
const pagesBase = process.env.BASE_PATH ?? '/T-Scope';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: isGitHubPages
			? adapterStatic({ fallback: 'index.html', strict: false })
			: adapterNode(),
		paths: isGitHubPages ? { base: pagesBase } : {},
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
