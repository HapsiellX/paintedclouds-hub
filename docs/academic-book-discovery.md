# Academic-book discovery

StefARR searches Open Library and lobid concurrently for books. Open Library
remains the broad international source; lobid adds authoritative records from
the hbz union catalog and is particularly useful for German academic and older
specialist publications. Results are merged by normalized title and year, with
canonical provider identifiers retained for later resolution.

Partial search responses remain usable when one external provider is
temporarily unavailable, but they are not cached. A later search therefore
retries the missing provider instead of preserving a transient failure for the
normal six-hour metadata TTL.

The detail page offers catalog and library routes such as WorldCat, Google
Books, and the corresponding lobid record. These are discovery links, not a
claim that a downloadable copy is licensed. StefARR does not scrape, proxy, or
automatically download an in-copyright scan from a catalog or digitization
portal. Users must follow the rights statement shown by the destination and use
purchase, lending, or interlibrary-loan access where applicable.

When a lobid record contains an ISBN, StefARR passes that canonical identifier
to the existing LazyLibrarian request workflow. Acquisition behavior and its
operator controls do not change: metadata catalog searches do not trigger a
download, and a book request still enters the normal review and downstream
queue lifecycle.

Operators should expect old works to have multiple editions and incomplete
metadata. Confirm author, title, publication year, publisher, and ISBN before
approving a request. If an exact query has no result, search by author and a
distinctive title fragment; a missing record is not evidence that the work is
freely available.
