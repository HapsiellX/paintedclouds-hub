describe('StefARR by PaintedClouds', () => {
  beforeEach(() => {
    cy.request('POST', '/api/v1/auth/jellyfin', {
      username: Cypress.env('JELLYFIN_USERNAME'),
      password: Cypress.env('JELLYFIN_PASSWORD'),
      email: 'hub-admin@example.com',
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

  it('loads requests without sending empty optional filters', () => {
    cy.intercept('GET', '/api/v1/hub/activity*', (request) => {
      const requestUrl = new URL(request.url);
      expect(requestUrl.searchParams.get('take')).to.equal('20');
      expect(requestUrl.searchParams.get('skip')).to.equal('0');
      expect(requestUrl.searchParams.has('kinds')).to.equal(false);
      expect(requestUrl.searchParams.has('formats')).to.equal(false);
      expect(requestUrl.searchParams.has('states')).to.equal(false);
      expect(requestUrl.searchParams.has('query')).to.equal(false);
      request.reply({
        results: [],
        take: 20,
        skip: 0,
        total: 0,
        hasMore: false,
      });
    }).as('requestActivity');

    cy.visit('/requests');
    cy.wait('@requestActivity').its('response.statusCode').should('eq', 200);
    cy.contains('Die Anfragen konnten nicht geladen werden.').should(
      'not.exist'
    );
  });

  it('shows curated music and book discovery shelves', () => {
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
