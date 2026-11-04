# Project: Jobly

Jobly is a job search and recruitment mobile app with the tagline "Connecting talent with opportunity." It bridges the gap between job seekers, companies, and freelancers, with a focus on speed and local offline access. It also has a community-driven "Tips & Advice" section and a multi-role administrative layer. Repository: https://github.com/Nasser117/Jobly

## Context and role

Jobly was a university project described in its README as a fourth-year project and an educational prototype that is not intended for production use. Al-Nasser Haddad worked on Jobly as a Mobile Developer. The README credits three mobile developers: Nasser Haddad, Anas Al-lahhaam, and Rami Abd Al-hameed.

## The three user roles in Jobly

1. Individual users: job seekers looking for jobs, internships, or courses.
2. Companies: organizations that post vacancies and manage applicants.
3. Admins: super-users who moderate content, verify accounts, and manage users.

## Jobly features by role

For companies: request official verification badges, publish, edit and delete job vacancies by sector, and browse incoming applications, view seeker profiles, and accept or reject candidates.

For individual users: build a profile with a video introduction, filter jobs by type (remote or on-site), location, category or sector, apply for jobs, save favorites, and rate companies they have worked for. A community hub lets verified users post career tips, and anyone can ask questions and get answers from experts. Users can like, report, or edit posts and comments. Offline job saving, advanced category filtering, and an application status tracker are the key features highlighted on the portfolio.

For admins: ban or unban users, delete problematic accounts, review and accept or reject verification requests, and monitor user profiles and community posts.

## Jobly architecture and tech stack

Jobly is built with Flutter and uses the MVVM pattern with Flutter BLoC (Cubit) for state management. The Model parses data and handles SQLite and API logic, the View is pure UI that reacts to state changes, and the ViewModel (Cubit) manages business logic and emits Loading, Success and Error states. Shared Preferences stores the theme and the login token. The portfolio lists the stack as Flutter, React, and Laravel.

The UI uses a bold magenta and white palette: magenta purple (#8A2BE2) as primary, deep purple (#4B0082) as secondary, pure white for backgrounds, and charcoal black (#333333) for text.

## Problem, solution, challenges and learnings (Jobly)

- Problem: fragmented job listings, difficult application tracking, and poor offline accessibility.
- Solution: a mobile app with local caching for seamless browsing and an intuitive application management system.
- Challenges: complex relational data modeling, handling asynchronous job feeds, and keeping the app fast with large datasets.
- Learnings: advanced BLoC state management, SQLite database optimization, and user-centric job filtering logic.
- Technical decisions: SQLite for persistent offline access, BLoC for predictable state transitions, and a modular repository pattern.
