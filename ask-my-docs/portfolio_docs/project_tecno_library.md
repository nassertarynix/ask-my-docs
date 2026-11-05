# Project: Tecno Library

Tecno Library is a digital library mobile app with the tagline "Your books. Organized. Everywhere." Its repository is named Techno-Library (https://github.com/Nasser117/Techno-Library). It helps users catalog, search, and manage their book collections, discover books, manage reading lists, interact with a community, and request book publishing.

## Context and role

Tecno Library was a third-year college group project from 2023. Al-Nasser Haddad worked on it as a Mobile Developer. The public repository contains the Flutter frontend only. Its maintainers are Nasser Haddad and Rami Abd-alhameed. The Laravel (PHP) backend is not included in the repository, so some features do not work without the server.

## Features of Tecno Library

- Authentication: secure user login and registration.
- Browse: an exploratory view of all available titles, with advanced search.
- Favorites: a personalized list for quick access.
- Reading progress: "Plan to Read" versus "Completed" tracking, and book lists.
- Cart: an integrated shopping cart system.
- Reviews: community feedback with 1 to 5 star ratings.
- Moderation: a report system for abusive comments.
- Publishing: admin-approved book publishing requests.

## Tecno Library architecture and tech stack

The Tecno Library app is built with Flutter (Dart) and follows a layered MVC architecture powered by GetX. The Model layer holds data structures and API models, the View layer holds UI screens, and the Controller layer holds business logic and state. GetX handles state management, dependency injection, and routing. The backend is Laravel (PHP), and Firebase is used for notifications. Local storage uses GetStorage and SQLite.

Packages used in Tecno Library: get, flutter_svg, http, image_picker, scroll_date_picker, get_storage, and flutter_rating_bar.

The UI uses a clean, minimal, reading-focused palette: white as primary, red as secondary, black as accent, and grey as neutral.

## Problem, solution, challenges and learnings (Tecno Library)

- Problem: scattered physical books, no centralized catalog, and difficult search and tracking.
- Solution: a digital library that lets users catalog, search, and manage books efficiently.
- Challenges: state management, data synchronization, and book categorization.
- Learnings: REST API integration, theme persistency, and scalable UI design.
- Technical decisions listed on the portfolio: dual apps versus roles, Bloc versus GetX, and clean architecture.
