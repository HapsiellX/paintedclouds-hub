import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'StefARR by PaintedClouds',
  tagline: 'Your private discovery and request hub for every media type',
  favicon: 'img/favicon.ico',

  url: 'https://github.com/HapsiellX/paintedclouds-hub',
  baseUrl: '/',
  trailingSlash: true,

  future: {
    faster: {
      swcJsMinimizer: true,
    },
  },

  organizationName: 'HapsiellX',
  projectName: 'paintedclouds-hub',
  deploymentBranch: 'gh-pages',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          path: '../docs',
          editUrl:
            'https://github.com/HapsiellX/paintedclouds-hub/edit/main/docs/',
          docItemComponent: '@theme/ApiItem',
          async sidebarItemsGenerator({
            defaultSidebarItemsGenerator,
            ...args
          }) {
            const items = await defaultSidebarItemsGenerator(args);
            return items.filter(
              (item) =>
                !(
                  item.type === 'category' &&
                  item.label?.toLowerCase() === 'api'
                )
            );
          },
        },
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'classic',
        config: {
          seerr: {
            specPath: '../seerr-api.yml',
            outputDir: '../docs/api',
            sidebarOptions: {
              groupPathsBy: 'tag',
            },
            downloadUrl:
              'https://raw.githubusercontent.com/HapsiellX/paintedclouds-hub/refs/heads/main/seerr-api.yml',
            hideSendButton: true,
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      /**  @type {import("@easyops-cn/docusaurus-search-local").PluginOptions}  */
      {
        hashed: true,
        indexBlog: false,
        docsDir: '../docs',
        docsRouteBasePath: '/',
        explicitSearchResultPath: true,
      },
    ],
    'docusaurus-theme-openapi-docs',
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      logo: {
        alt: 'StefARR by PaintedClouds',
        src: 'img/logo_full.svg',
      },
      items: [
        {
          to: '/api/seerr-api',
          label: 'REST API',
          position: 'right',
        },
        {
          href: 'https://github.com/HapsiellX/paintedclouds-hub',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Documentation',
              to: '/',
            },
            {
              label: 'REST API',
              to: '/api/seerr-api',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/HapsiellX/paintedclouds-hub',
            },
          ],
        },
        {
          title: 'Project lineage',
          items: [
            {
              label: 'Attribution',
              href: 'https://github.com/HapsiellX/paintedclouds-hub/blob/main/ATTRIBUTION.md',
            },
            {
              label: 'Seerr upstream',
              href: 'https://github.com/seerr-team/seerr',
            },
          ],
        },
      ],
      copyright: `StefARR by PaintedClouds. Independent MIT-licensed fork of Seerr. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.shadesOfPurple,
      darkTheme: prismThemes.shadesOfPurple,
      additionalLanguages: [
        'bash',
        'powershell',
        'yaml',
        'nix',
        'nginx',
        'batch',
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
