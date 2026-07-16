describe('PaintedClouds Hub', () => {
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
    cy.visit('/hub');
    cy.contains('a', 'Filme').should('exist');
    cy.contains('a', 'Serien & Anime').should('exist');
    cy.contains('a', 'Musik').should('exist');
    cy.contains('a', 'Bücher & Hörbücher').should('exist');
  });

  it('shows curated music and book discovery shelves', () => {
    cy.visit('/discover/music');
    cy.get('[data-testid=music-discover-shelves]').should('be.visible');
    cy.get('[data-testid=music-discover-card]').should(
      'have.length.at.least',
      12
    );
    cy.contains('Metal & Rock').should('be.visible');

    cy.visit('/discover/books');
    cy.get('[data-testid=books-discover-shelves]').should('be.visible');
    cy.get('[data-testid=books-discover-card]').should(
      'have.length.at.least',
      12
    );
    cy.contains('Gerade beliebt').should('be.visible');
  });
});
