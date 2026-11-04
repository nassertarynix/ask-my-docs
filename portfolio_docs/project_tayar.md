# Project: Tayar Shop (TAYAR)

TAYAR is a specialized platform for solar energy solutions, with the tagline "E-commerce, simplified." It lets homeowners and businesses move to renewable energy through a marketplace for solar hardware (solar panels, inverters, and batteries) and a direct link to professional maintenance services. The user application repository is https://github.com/Nasser117/Tayar-user

## Context and role

TAYAR was a 5th-year graduation project (2024 to 2025) at Damascus University. Al-Nasser Haddad was the Team Lead and a Mobile Developer on Tayar Shop. The repository README credits Nasser Haddad (Team Lead) and Rami Abd-alhameed for the frontend. The project has two apps, one for shoppers and one for maintenance workshops, so the portfolio shows separate user and worker screens.

## Features of the TAYAR user app

- Authentication: secure login and registration for individual customers.
- E-commerce hub: browse solar panels, inverters, and batteries with detailed product specifications and images, a shopping cart, and order history.
- Financial services: real-time purchase invoice generation and secure payment processing through Stripe.
- Digital warranties: view and track the validity of product warranties.
- FAQ and support: a library of solar energy knowledge, plus full after-purchase support.
- Service booking: request professional maintenance visits for existing solar setups.
- A simple set recommendation system and real-time order updates, as listed on the portfolio.

## Tayar architecture and tech stack

The TAYAR user app is built with Flutter (Material 3). State management uses BLoC / Cubit, and the architecture follows the MVVM pattern. The backend of Tayar is Laravel, chosen as a custom, scalable backend. The portfolio also lists React in the stack. Other technical decisions: dual apps to handle the shop and maintenance sides, and Cubit for state management. Stripe API keys are configured through environment variables.

## Problem, solution, challenges and learnings (Tayar Shop)

- Problem: high friction in checkout processes, lack of after-purchase services, and inconsistent product management.
- Solution: a secure, fast-loading retail app with integrated Stripe payments.
- Challenges: payment integration, handling real-time stock updates, and secure user authentication.
- Learnings: financial transaction security, backend-to-frontend communication, and scalable product cataloging.
