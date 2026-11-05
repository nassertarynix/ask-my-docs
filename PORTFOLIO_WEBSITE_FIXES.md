# Portfolio website: fixes to make

> **Project this file is about:** Al-Nasser Haddad's **portfolio website**
> (https://al-nasser-haddad.pages.dev/) and the GitHub READMEs of the projects it showcases.
> **It is NOT about the "Ask My Docs" RAG project.**
>
> Written 2026-11-04 from the live `data/data.js` (line numbers are for that deployed
> version; re-check them if the file changed) and from the public project READMEs.
> Facts below marked "confirmed" were confirmed by the author in conversation.

## Confirmed facts (use these as the source of truth)

| Topic | Confirmed fact |
|---|---|
| Graduation project | **TAYAR**: the 5th and final year (2024-2025) of the five-year Software Engineering degree, class of 2025 |
| TAYAR's three apps | Flutter **shop** app, Flutter **worker** app, and a **React admin dashboard** (a web page, not a Flutter app) |
| TAYAR backend | **Laravel** (not Node.js) |
| Jobly | A **fourth-year** project, **not** the graduation project. React is used for its **dashboards** |
| Tecno Library | 2023 third-year group project. Flutter + GetX frontend, **Laravel** backend, **Firebase for notifications** |
| Spelling | Keep **"Tecno"** Library |
| CV vs portfolio | The **CV** lists the full stacks the apps were built with. The **portfolio** lists what the author **personally worked in** on each project |

## A. Fixes in the portfolio website (`data/data.js`)

- [ ] **Line 19, `aboutMe.description`: "three-app Flutter graduation project".**
  One of the three apps is the React admin dashboard, so "Flutter" is wrong for all three.
  Suggested wording: "...I led my graduation project, TAYAR, as team lead: three apps
  (Flutter shop and worker apps, plus a React admin dashboard)."
- [ ] **Line 155, Tayar `solution`: "...and a custom Node.js backend."**
  Contradicts the same entry's `technicalDecisions` (line 159: "Laravel for a custom,
  scalable backend") and `techStack` (line 152). Change to a Laravel backend, e.g.
  "...with integrated Stripe payments and a Laravel backend."
- [ ] **Line 127, Tayar `description`: generic "modern e-commerce platform".**
  It never says the shop sells **solar energy hardware** (panels, inverters, batteries) with
  maintenance-service booking, which is what the repo README says. Suggested: "A solar energy
  marketplace and maintenance-booking platform: shop for panels, inverters and batteries, pay
  with Stripe, track warranties and request maintenance visits."
- [ ] **Line 72, Tecno Library `techStack`: Firebase has no explanation.**
  Its repo README never mentions it. Say what it is for, e.g. add "Firebase for
  notifications" to `keyFeatures` (line 78) or `technicalDecisions` (line 79).
- [ ] **Lines 114 and 152, `techStack` of Jobly and Tayar: "React".**
  Readers will assume the mobile apps use React. Clarify it is for the dashboards, e.g.
  "React (admin dashboards)", or label the field "My stack".
- [ ] **Tayar has three apps but the portfolio only shows two.**
  Images exist for `tayar/user` and `tayar/worker`. Consider adding admin-dashboard
  screenshots, and mention the worker app and dashboard in the text.
- [ ] **Line 79, Tecno `technicalDecisions`: "Bloc vs Getx".**
  Not wrong, but the outcome is missing. The repo uses **GetX**. Suggested: "GetX over Bloc".
- [ ] **Optional: "my stack" vs "built with".**
  Since the CV lists full stacks and the portfolio lists personal contribution, label the
  portfolio field (e.g. "My stack") so a recruiter comparing the two does not see a mismatch.

## B. Fixes in the GitHub repositories (not the portfolio itself)

**`Nasser117/Jobly` README**
- [ ] "fourth-year university project **(Graduation Year)**": remove "(Graduation Year)".
- [ ] Mention that the project also has React dashboards.
- [ ] Clone URL is a placeholder: `https://github.com/yourusername/jobly.git`.
- [ ] Typo: "Shared **Prefrences**".

**`Nasser117/Techno-Library` README** (repo name has "Techno"; you keep "Tecno")
- [ ] A large **commented-out older README** (`<!-- ... -->`) sits at the top: delete it.
- [ ] The screenshots table is empty, and a leftover tip says "Add a `/screenshots/demo.gif`".
- [ ] Clone URL is a placeholder: `https://github.com/yourusername/tecno-library.git`.
- [ ] Spelled "Techno Library" throughout; make it "Tecno Library" to match the portfolio
      (optionally rename the repo to `Tecno-Library`; GitHub redirects old links), and update
      the `githubUrl` on line 73 if you rename it.
- [ ] Mention **Firebase (notifications)**.

**`Nasser117/Tayar-user` README**
- [ ] Say this is **one of three apps** (shop, worker, React admin dashboard), and that the
      backend is Laravel.
- [ ] The project-structure comment says "UI Screens (User, Company, Admin directories)",
      which looks copied from Jobly. This is the user app only.
- [ ] The tree lists a `buting/` folder. Check whether it is really named that or is a typo
      of `buying`.

## C. Already handled

The "Ask My Docs" demo documents (`portfolio_docs/` in `nassertarynix/ask-my-docs`) already
use the confirmed facts above, so nothing there needs changing unless you reword the
portfolio. If you change wording on the portfolio, tell me and I will update those documents
so the demo bot stays consistent with the site.
