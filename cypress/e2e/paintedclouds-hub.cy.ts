describe('StefARR by PaintedClouds', () => {
  beforeEach(() => {
    if (Cypress.env('JELLYFIN_USERNAME')) {
      cy.request('POST', '/api/v1/auth/jellyfin', {
        username: Cypress.env('JELLYFIN_USERNAME'),
        password: Cypress.env('JELLYFIN_PASSWORD'),
        email: 'hub-admin@example.com',
      });
    } else {
      cy.loginAsAdmin();
    }
    cy.request('/api/v1/auth/me').then(({ body: user }) => {
      cy.request('POST', `/api/v1/user/${user.id}/settings/main`, {
        username: user.username,
        email: user.email,
        locale: 'de',
      });
    });
  });

  it('finds artists and albums in the Hub search', () => {
    cy.intercept('GET', '/api/v1/hub/search*').as('hubSearch');
    cy.visit('/hub?kinds=music_artist,music_album');
    cy.get('[data-testid=hub-search-input]').type('Linkin Park');
    cy.get('[data-testid=hub-search-submit]').click();
    cy.wait('@hubSearch').its('response.statusCode').should('eq', 200);
    cy.get('[data-testid=hub-result-music_artist]').should(
      'have.length.at.least',
      1
    );
    cy.get('[data-testid=hub-result-music_album]').should(
      'have.length.at.least',
      1
    );
  });

  it('uses the unified catalog from the global search route', () => {
    cy.visit('/search?query=Rammstein');
    cy.get('[data-testid=hub-search-results]').should('be.visible');
    cy.get('[data-testid=hub-result-music_artist]').should(
      'have.length.at.least',
      1
    );
  });

  it('offers direct navigation for every media group', () => {
    cy.visit('/');
    cy.contains('a', 'Hub').should('not.exist');
    cy.contains('a', 'Anfragen').should('have.attr', 'href', '/requests');
    cy.contains('a', 'Filme').should('exist');
    cy.contains('a', 'Serien & Anime').should('exist');
    cy.contains('a', 'Musik').should('exist');
    cy.contains('a', 'Bücher & Hörbücher').should('exist');
  });

  it('shows current movie, streaming series and anime shelves', () => {
    const emptyPage = {
      page: 1,
      totalPages: 0,
      totalResults: 0,
      results: [],
    };
    cy.intercept('GET', '/api/v1/discover/trending*', emptyPage);
    cy.intercept('GET', '/api/v1/discover/movies*', emptyPage);
    cy.visit('/discover/movies');
    cy.contains('Jetzt im Trend').should('be.visible');
    cy.contains('Neue, beliebte Filme').should('be.visible');
    cy.contains('Alle Filme').should('be.visible');

    cy.intercept('GET', '/api/v1/discover/tv/current*', emptyPage);
    cy.intercept('GET', '/api/v1/discover/tv*', emptyPage);
    cy.visit('/discover/tv');
    cy.contains('Gerade beliebt auf Streamingdiensten').should('be.visible');
    cy.contains('Aktuell gefeierte Serien').should('be.visible');
    cy.contains('Aktuelle beliebte Anime').should('be.visible');
    cy.contains('Alle Serien & Anime').should('be.visible');
  });

  it('keeps personalization, discovery and requests reachable on mobile', () => {
    cy.viewport('iphone-x');
    cy.visit('/');
    cy.get('nav').contains('a', 'Hub').should('not.exist');
    cy.contains('a', 'Für dich').should('exist');
    cy.contains('a', 'Merkliste').should('exist');
    cy.get('button[aria-label="Weitere Navigation"]').click();
    cy.contains('a', 'Anfragen').should('have.attr', 'href', '/requests');
  });

  it('shows truthful acquisition stages without sending empty filters', () => {
    const acquisition = (
      phase:
        | 'waiting_for_release'
        | 'queued'
        | 'downloading'
        | 'paused'
        | 'extracting'
        | 'partially_available'
        | 'failed',
      overrides: Record<string, unknown> = {}
    ) => ({
      phase,
      health: phase === 'failed' ? 'error' : 'ok',
      availability: 'missing',
      progress: phase === 'downloading' ? 75 : 0,
      downloadedBytes: phase === 'downloading' ? 1_500_000_000 : 0,
      totalBytes: phase === 'downloading' ? 2_000_000_000 : 0,
      updatedAt: '2026-07-19T12:00:00.000Z',
      stale: false,
      sources: ['sabnzbd', 'sonarr'],
      parts: [],
      ...overrides,
    });
    const active = {
      id: 'video:303',
      kind: 'movie',
      externalId: '303',
      title: 'Fortschrittsfilm',
      is4k: false,
      acquisition: acquisition('downloading', {
        queuePosition: 1,
        timeLeft: '00:05:00',
      }),
    };
    const waiting = {
      id: 'video:304',
      kind: 'movie',
      externalId: '304',
      title: 'Wartender Film',
      acquisition: acquisition('waiting_for_release', { queuePosition: 2 }),
    };
    const processing = {
      id: 'video:305',
      kind: 'tv',
      externalId: '305',
      title: 'MONSTER',
      acquisition: acquisition('extracting', {
        progress: 100,
        downloadedBytes: 3_000_000_000,
        totalBytes: 3_000_000_000,
        counts: { requested: 74, queued: 0, imported: 0, failed: 0 },
      }),
    };
    const paused = {
      id: 'video:306',
      kind: 'tv',
      externalId: '306',
      title: 'Pausierte Serie',
      acquisition: acquisition('paused'),
    };
    const failedIssue = {
      id: 41,
      reasonCode: 'IMPORT_FAILED',
      message: 'Der Import in die Bibliothek ist fehlgeschlagen.',
      retryable: true,
      acknowledged: false,
    };
    const failed = {
      id: 'video:307',
      kind: 'movie',
      externalId: '307',
      title: 'Fehlgeschlagener Film',
      acquisition: acquisition('failed', {
        issue: failedIssue,
      }),
    };
    const partial = {
      id: 'video:309',
      kind: 'tv',
      externalId: '309',
      title: 'Teilweise vorhandene Serie',
      acquisition: acquisition('partially_available', {
        availability: 'partial',
        counts: { requested: 12, queued: 0, imported: 5, failed: 0 },
      }),
    };

    cy.intercept('GET', '/api/v1/hub/activity*', (request) => {
      const requestUrl = new URL(request.url);
      expect(requestUrl.searchParams.get('take')).to.equal('20');
      expect(requestUrl.searchParams.get('skip')).to.equal('0');
      expect(requestUrl.searchParams.has('kinds')).to.equal(false);
      expect(requestUrl.searchParams.has('formats')).to.equal(false);
      expect(requestUrl.searchParams.has('states')).to.equal(false);
      expect(requestUrl.searchParams.has('query')).to.equal(false);
      request.reply({
        results: [
          {
            id: 'video:305',
            source: 'seerr',
            sourceId: 305,
            kind: 'tv',
            provider: 'tmdb',
            externalId: '305',
            title: 'MONSTER',
            state: 'submitted',
            requestedBy: {
              id: 1,
              displayName: 'Admin',
              avatar: '',
            },
            createdAt: '2026-07-19T10:00:00.000Z',
            updatedAt: '2026-07-19T12:00:00.000Z',
            is4k: false,
            acquisition: processing.acquisition,
          },
        ],
        acquisitionQueue: {
          summary: {
            total: 6,
            queued: 2,
            waitingForRelease: 1,
            downloading: 1,
            processing: 1,
            importPending: 0,
            paused: 1,
            failed: 1,
            progress: 90,
            downloadedBytes: 4_500_000_000,
            totalBytes: 5_000_000_000,
          },
          groups: {
            downloading: [active, partial],
            queued: [waiting],
            processing: [processing],
            paused: [paused],
            problems: [failed],
          },
          issues: [failed],
          recentIssues: [
            {
              source: 'seerr',
              requestId: 308,
              title: 'Gelöster Film',
              kind: 'movie',
              reasonCode: 'download_failed',
              message:
                'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
              resolvedAt: '2026-07-19T11:45:00.000Z',
              acknowledged: true,
            },
          ],
          observedAt: '2026-07-19T12:00:00.000Z',
          lastUpdatedAt: '2026-07-19T12:00:00.000Z',
          stale: false,
        },
        take: 20,
        skip: 0,
        total: 1,
        hasMore: false,
      });
    }).as('requestActivity');
    cy.intercept('POST', '/api/v1/hub/acquisition/issues/41/retry', {
      statusCode: 200,
      body: failed.acquisition,
    }).as('retryAcquisition');
    cy.intercept(
      'POST',
      '/api/v1/hub/acquisition/issues/41/acknowledge',
      (request) => {
        failedIssue.acknowledged = true;
        request.reply({ statusCode: 200, body: { acknowledged: true } });
      }
    ).as('acknowledgeAcquisition');

    cy.visit('/requests');
    cy.wait('@requestActivity').its('response.statusCode').should('eq', 200);
    cy.contains('Die Anfragen konnten nicht geladen werden.').should(
      'not.exist'
    );
    cy.contains('Downloads und Verarbeitung').should('be.visible');
    cy.contains('h3', 'Aktiv').should('be.visible');
    cy.contains('h3', 'Wartet').should('be.visible');
    cy.contains('h3', 'Nachbearbeitung und Import').should('be.visible');
    cy.contains('h3', 'Pausiert').should('be.visible');
    cy.contains('h3', 'Eingriff nötig').should('be.visible');
    cy.get('[data-testid=acquisition-summary-problems]').should('contain', '1');
    cy.get('[data-testid=acquisition-summary-downloading]').should(
      'contain',
      '1'
    );
    cy.get('[data-testid=acquisition-summary-queued]').should('contain', '2');
    cy.get('[data-testid=acquisition-item-problems]').should('have.length', 1);
    cy.contains('Teilweise vorhandene Serie')
      .parents('[data-testid=acquisition-item-queued]')
      .should('contain', 'Teilweise verfügbar');
    cy.contains('h3', 'Kürzlich gelöst').should('be.visible');
    cy.get('[data-testid=recent-acquisition-issue]')
      .should('have.length', 1)
      .within(() => {
        cy.contains('Gelöster Film').should('be.visible');
        cy.contains(
          'Der Download oder die Nachbearbeitung ist fehlgeschlagen.'
        ).should('be.visible');
        cy.get('time')
          .should('have.attr', 'datetime', '2026-07-19T11:45:00.000Z')
          .and('be.visible');
        cy.get('button').should('not.exist');
      });
    cy.contains('Fortschrittsfilm').should('be.visible');
    cy.contains('Platz 1').should('be.visible');
    cy.contains('0 von 74 importiert').should('be.visible');
    cy.contains(
      'Download vollständig – Nachbearbeitung oder Import ist noch nicht abgeschlossen.'
    ).should('be.visible');
    cy.contains('Noch nicht in Jellyfin verfügbar').should('be.visible');
    cy.get('[role=progressbar][aria-valuenow=75]').should(
      'have.length.at.least',
      1
    );
    cy.get('[role=progressbar][aria-valuenow=100]')
      .should('have.attr', 'aria-valuetext')
      .and('contain', 'Wird entpackt');

    cy.contains('button', 'Download erneut versuchen')
      .focus()
      .should('have.focus')
      .click();
    cy.wait('@retryAcquisition').its('response.statusCode').should('eq', 200);
    cy.get('#acquisition-heading').should('have.focus');
    cy.get('[role=status]').should(
      'contain',
      'Der erneute Downloadversuch wurde gestartet.'
    );
    cy.contains('button', 'Problem bestätigen').click();
    cy.wait('@acknowledgeAcquisition')
      .its('response.statusCode')
      .should('eq', 200);
    cy.get('#acquisition-heading').should('have.focus');
    cy.get('[role=status]').should('contain', 'Das Problem wurde bestätigt.');
    cy.contains('button', 'Download erneut versuchen').should('be.visible');
    cy.contains('button', 'Problem bestätigen').should('not.exist');
  });

  it('does not offer acquisition issue actions without management permission', () => {
    cy.intercept('GET', '/api/v1/auth/me', {
      id: 2,
      warnings: [],
      displayName: 'Friend',
      username: 'friend',
      email: 'friend@seerr.dev',
      avatar: '',
      permissions: 32,
      userType: 1,
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-19T10:00:00.000Z',
      requestCount: 1,
      settings: { locale: 'de', notificationTypes: {} },
    }).as('normalUser');
    cy.intercept('GET', '/api/v1/hub/activity*', {
      results: [],
      acquisitionQueue: {
        summary: {
          total: 1,
          queued: 0,
          waitingForRelease: 0,
          downloading: 0,
          processing: 0,
          importPending: 0,
          paused: 0,
          failed: 1,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
        },
        groups: {
          downloading: [],
          queued: [],
          processing: [],
          paused: [],
          problems: [
            {
              id: 'video:401',
              kind: 'movie',
              externalId: '401',
              title: 'Problem ohne Verwaltungsrecht',
              acquisition: {
                phase: 'failed',
                health: 'error',
                availability: 'missing',
                progress: 0,
                downloadedBytes: 0,
                totalBytes: 0,
                updatedAt: '2026-07-19T12:00:00.000Z',
                stale: false,
                sources: ['radarr'],
                parts: [],
                issue: {
                  id: 51,
                  reasonCode: 'download_failed',
                  message:
                    'Der Download oder die Nachbearbeitung ist fehlgeschlagen.',
                  retryable: true,
                  acknowledged: false,
                },
              },
            },
          ],
        },
        issues: [],
        recentIssues: [],
        observedAt: '2026-07-19T12:00:00.000Z',
        stale: false,
      },
      take: 20,
      skip: 0,
      total: 0,
      hasMore: false,
    }).as('normalUserActivity');

    cy.visit('/requests');
    cy.wait('@normalUser');
    cy.wait('@normalUserActivity');
    cy.contains('Problem ohne Verwaltungsrecht').should('be.visible');
    cy.contains('button', 'Download erneut versuchen').should('not.exist');
    cy.contains('button', 'Problem bestätigen').should('not.exist');
  });

  it('localizes open and recent acquisition issues instead of leaking provider language', () => {
    cy.request('/api/v1/auth/me').then(({ body: user }) => {
      cy.request('POST', `/api/v1/user/${user.id}/settings/main`, {
        username: user.username,
        email: user.email,
        locale: 'en',
      });
    });
    const failedAcquisition = {
      phase: 'failed',
      health: 'error',
      availability: 'missing',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      updatedAt: '2026-07-19T12:00:00.000Z',
      stale: false,
      sources: ['radarr'],
      parts: [],
      issue: {
        id: 61,
        reasonCode: 'provider_failed',
        message: 'Der Anbieter ist fehlgeschlagen.',
        retryable: true,
        acknowledged: false,
        episodes: [{ seasonNumber: 0, episodeNumber: 1 }],
      },
    };
    cy.intercept('GET', '/api/v1/hub/activity*', {
      results: [],
      acquisitionQueue: {
        summary: {
          total: 2,
          queued: 0,
          waitingForRelease: 0,
          downloading: 0,
          processing: 0,
          importPending: 0,
          paused: 0,
          failed: 1,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
        },
        groups: {
          downloading: [],
          queued: [],
          processing: [],
          paused: [],
          problems: [
            {
              id: 'video:601',
              kind: 'movie',
              externalId: '601',
              title: 'Open provider issue',
              acquisition: failedAcquisition,
            },
            {
              id: 'video:603',
              kind: 'tv',
              externalId: '603',
              title: 'Open provider issue',
              acquisition: {
                ...failedAcquisition,
                issue: {
                  ...failedAcquisition.issue,
                  id: 62,
                  episodes: [{ seasonNumber: 1, episodeNumber: 3 }],
                },
              },
            },
          ],
        },
        issues: [],
        recentIssues: [
          {
            source: 'seerr',
            requestId: 602,
            title: 'Resolved provider issue',
            kind: 'movie',
            reasonCode: 'provider_failed',
            message: 'Der Anbieter ist fehlgeschlagen.',
            resolvedAt: '2026-07-19T11:45:00.000Z',
            acknowledged: true,
          },
        ],
        observedAt: '2026-07-19T12:00:00.000Z',
        stale: false,
      },
      take: 20,
      skip: 0,
      total: 0,
      hasMore: false,
    }).as('localizedIssues');

    cy.visit('/requests');
    cy.wait('@localizedIssues');
    cy.get('[data-testid=acquisition-item-problems]')
      .eq(0)
      .should('contain', 'Open provider issue')
      .and('contain', 'The media service failed or is currently unavailable.')
      .and('contain', 'Affected episodes: S00E01');
    cy.get('[data-testid=acquisition-item-problems]')
      .eq(1)
      .should('contain', 'Open provider issue')
      .and('contain', 'Affected episodes: S01E03');
    cy.get('[data-testid=recent-acquisition-issue]').should(
      'contain',
      'The media service failed or is currently unavailable.'
    );
    cy.contains('Der Anbieter ist fehlgeschlagen.').should('not.exist');
  });

  it('debounces request search while keeping typed text responsive', () => {
    const activityQueries: string[] = [];
    cy.intercept('GET', '/api/v1/hub/activity*', (request) => {
      activityQueries.push(
        new URL(request.url).searchParams.get('query') ?? ''
      );
      request.reply({
        results: [],
        acquisitionQueue: {
          summary: {
            total: 0,
            queued: 0,
            waitingForRelease: 0,
            downloading: 0,
            processing: 0,
            importPending: 0,
            paused: 0,
            failed: 0,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
          },
          groups: {
            downloading: [],
            queued: [],
            processing: [],
            paused: [],
            problems: [],
          },
          issues: [],
          recentIssues: [],
          observedAt: '2026-07-19T12:00:00.000Z',
          stale: false,
        },
        take: 20,
        skip: 0,
        total: 0,
        hasMore: false,
      });
    }).as('debouncedActivity');

    cy.visit('/requests');
    cy.wait('@debouncedActivity');
    cy.contains('label', 'Suchen')
      .find('input')
      .type('Monster', { delay: 15 })
      .should('have.value', 'Monster');
    cy.wait(150).then(() => {
      expect(activityQueries).to.deep.equal(['']);
    });
    cy.wait('@debouncedActivity');
    cy.then(() => {
      expect(activityQueries).to.deep.equal(['', 'Monster']);
    });
  });

  it('keeps backend cursor and skip history across sparse activity pages', () => {
    const paginationStates: string[] = [];
    const activityResult = (sourceId: number, title: string) => ({
      id: `hub:${sourceId}`,
      source: 'hub',
      sourceId,
      kind: 'book',
      provider: 'openlibrary',
      externalId: `OL${sourceId}W`,
      title,
      state: 'submitted',
      requestedBy: { id: 1, displayName: 'Admin', avatar: '' },
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-19T12:00:00.000Z',
    });

    cy.intercept('GET', '/api/v1/hub/activity*', (request) => {
      const params = new URL(request.url).searchParams;
      const query = params.get('query');
      const cursor = params.get('scanCursor');
      const skip = params.get('skip');
      paginationStates.push(`${query ?? ''}:${cursor ?? ''}:${skip}`);

      if (query !== 'Sparse') {
        request.reply({
          results: [],
          take: 20,
          skip: 0,
          total: 0,
          hasMore: false,
        });
        return;
      }

      if (!cursor) {
        request.reply({
          results: [],
          take: 20,
          skip: 0,
          total: 0,
          totalIsEstimate: true,
          scanExhausted: true,
          nextScanCursor: 100,
          nextSkip: 0,
          hasMore: true,
        });
        return;
      }

      if (cursor === '100' && skip === '0') {
        request.reply({
          results: [activityResult(500, 'Später Treffer')],
          take: 20,
          skip: 0,
          total: 1,
          totalIsEstimate: true,
          scanExhausted: false,
          nextScanCursor: 100,
          nextSkip: 20,
          hasMore: true,
        });
        return;
      }

      request.reply({
        results: [activityResult(501, 'Noch späterer Treffer')],
        take: 20,
        skip: 20,
        total: 1,
        totalIsEstimate: true,
        scanExhausted: false,
        hasMore: false,
      });
    }).as('cursorActivity');

    cy.visit('/requests');
    cy.wait('@cursorActivity');
    cy.contains('label', 'Suchen').find('input').type('Sparse');
    cy.wait('@cursorActivity');
    cy.contains('Auf dieser Scan-Seite noch keine Treffer').should(
      'be.visible'
    );

    cy.contains('button', 'Weiter').click();
    cy.wait('@cursorActivity');
    cy.contains('Später Treffer').should('be.visible');
    cy.contains('Seite 2').should('be.visible');

    cy.contains('button', 'Weiter').click();
    cy.wait('@cursorActivity');
    cy.contains('Noch späterer Treffer').should('be.visible');
    cy.contains('Seite 3').should('be.visible');

    cy.contains('button', 'Zurück').click();
    cy.contains('Später Treffer').should('be.visible');
    cy.then(() => {
      expect(paginationStates).to.deep.equal([
        '::0',
        'Sparse::0',
        'Sparse:100:0',
        'Sparse:100:20',
      ]);
    });

    cy.contains('label', 'Status').find('select').select('Übermittelt');
    cy.wait('@cursorActivity');
    cy.then(() => {
      expect(paginationStates.at(-1)).to.equal('Sparse::0');
    });
  });

  it('keeps stale music status honest and usable on mobile', () => {
    const staleMusic = {
      id: 'hub:91',
      kind: 'music_album',
      externalId: 'release-91',
      title: 'Unbekannter Albumstatus',
      acquisition: {
        phase: 'unknown',
        health: 'stale',
        availability: 'missing',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        updatedAt: '2026-07-19T11:55:00.000Z',
        stale: true,
        sources: ['lidarr'],
        parts: [],
      },
    };
    cy.intercept('GET', '/api/v1/hub/activity*', {
      results: [],
      acquisitionQueue: {
        summary: {
          total: 1,
          queued: 0,
          waitingForRelease: 0,
          downloading: 0,
          processing: 0,
          importPending: 0,
          paused: 0,
          failed: 0,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
        },
        groups: {
          downloading: [],
          queued: [],
          processing: [],
          paused: [],
          problems: [staleMusic],
        },
        issues: [],
        recentIssues: [],
        observedAt: '2026-07-19T12:00:00.000Z',
        lastUpdatedAt: '2026-07-19T11:55:00.000Z',
        stale: true,
      },
      take: 20,
      skip: 0,
      total: 0,
      hasMore: false,
    });

    cy.viewport('iphone-x');
    cy.visit('/requests');
    cy.contains('Live-Status derzeit nicht erreichbar').should('be.visible');
    cy.contains('Unbekannter Albumstatus')
      .parents('[data-testid=acquisition-item-problems]')
      .within(() => {
        cy.contains('Noch nicht im Zielsystem verfügbar').should('be.visible');
        cy.contains('Jellyfin').should('not.exist');
      });
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth
      );
    });
  });

  it('shows curated music and book discovery shelves', () => {
    cy.intercept('GET', '/api/v1/hub/discover/music', {
      shelves: [
        {
          id: 'latest-music',
          title: 'Aktuelle Veröffentlichungen',
          description: 'Neue Alben',
          items: [
            {
              kind: 'music_album',
              provider: 'musicbrainz',
              externalId: 'album-1',
              title: 'Aktuelles Testalbum',
            },
          ],
        },
      ],
      errors: [],
    });
    cy.intercept('GET', '/api/v1/hub/discover/books', {
      shelves: [
        {
          id: 'popular-books',
          title: 'Gerade beliebt',
          description: 'Beliebte Bücher',
          items: Array.from({ length: 12 }, (_, index) => ({
            kind: 'book',
            provider: 'openlibrary',
            externalId: `OL${index + 1}W`,
            title: `Testbuch ${index + 1}`,
          })),
        },
      ],
      errors: [],
    });

    cy.visit('/discover/music');
    cy.get('[data-testid=music-discover-shelves]').should('be.visible');
    cy.get('[data-testid=music-discover-card]').should(
      'have.length.at.least',
      1
    );
    cy.get('#search_field').should('not.exist');
    cy.get('[data-testid=music-discover-search]').should('be.visible');
    cy.contains('Deine Musikquellen').should('be.visible');

    cy.visit('/discover/books');
    cy.get('[data-testid=books-discover-shelves]').should('be.visible');
    cy.get('[data-testid=books-discover-card]').should(
      'have.length.at.least',
      12
    );
    cy.contains('Gerade beliebt').should('be.visible');
  });

  it('supports the personalized feed, feedback, saved list and reset', () => {
    cy.intercept('GET', '/api/v1/hub/personalization/profile', {
      enabled: true,
      preferredMediaKinds: [],
      preferredGenres: ['fantasy'],
      preferredLanguages: ['de'],
    });
    cy.intercept('GET', '/api/v1/hub/recommendations*', {
      enabled: true,
      errors: [],
      shelves: [
        {
          id: 'mixed',
          reasonCode: 'MIXED_FOR_YOU',
          items: [
            {
              kind: 'book',
              provider: 'openlibrary',
              externalId: 'OL123W',
              title: 'Empfohlenes Buch',
              genres: ['fantasy'],
              recommendationReasons: [{ code: 'PREFERRED_GENRE' }],
            },
          ],
        },
      ],
    });
    cy.intercept('PUT', '/api/v1/hub/personalization/items', {
      liked: true,
      hidden: false,
      saved: true,
    }).as('feedback');
    cy.visit('/for-you');
    cy.get('[data-testid=for-you-feed]').should('be.visible');
    cy.contains('In einem deiner Lieblingsgenres').should('be.visible');
    cy.get('[data-testid=recommendation-like]').click();
    cy.wait('@feedback').its('request.body.liked').should('eq', true);
    cy.get('[data-testid=recommendation-save]').click();
    cy.wait('@feedback').its('request.body.saved').should('eq', true);
    cy.get('[data-testid=recommendation-hide]').click();
    cy.wait('@feedback').its('request.body.hidden').should('eq', true);
  });
});
