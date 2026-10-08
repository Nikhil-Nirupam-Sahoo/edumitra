/**
 * Class 9 syllabus — Math, Science, Social Science, English.
 * Hand-written NCERT-aligned micro-lessons in the same
 * text → quiz (with explanation) → summary format as Class 8.
 */

import { quizCard, summaryCard, textCard, type SeedLesson } from './types';

export const CLASS_9_LESSONS: SeedLesson[] = [
  // ------------------------------------------------------------------ Math
  {
    id: 'c9-math-polynomials',
    title: 'Polynomials',
    grade: 9,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'Dealing in powers of x',
        'A polynomial in x is a sum of terms like a·xⁿ, where n is a whole number. p(x) = 3x³ − 2x² + 5x − 1. The highest power is the DEGREE: degree 1 is linear, degree 2 is quadratic, degree 3 is cubic.',
      ),
      textCard(
        'c2',
        'Zeroes and identities',
        "A zero of p(x) is a value where p(x) = 0 — for p(x) = x − 4, the zero is x = 4. Handy identities: (a+b)² = a² + 2ab + b², (a−b)² = a² − 2ab + b², a² − b² = (a+b)(a−b). Factor theorem: if p(a) = 0, then (x − a) is a factor.",
      ),
      quizCard(
        'c3',
        'q1',
        'What is the degree of 3x³ − 2x² + 5x − 1?',
        ['1', '2', '3', '5'],
        2,
        'The term with the highest power is 3x³ → degree 3 (a cubic polynomial).',
      ),
      quizCard(
        'c4',
        'q2',
        'What is the zero of p(x) = x − 4?',
        ['−4', '4', '0', '1/4'],
        1,
        'x − 4 = 0 → x = 4. Substitute and check: p(4) = 4 − 4 = 0.',
      ),
      quizCard(
        'c5',
        'q3',
        'Expand: (x + 3)²',
        ['x² + 9', 'x² + 6x + 9', 'x² + 3x + 9', 'x² + 6x + 3'],
        1,
        'Using (a+b)² = a² + 2ab + b² with a = x, b = 3: x² + 2·x·3 + 9 = x² + 6x + 9.',
      ),
      summaryCard(
        'c6',
        'Degree = highest power. Zero = where p(x)=0. Identities: (a±b)² = a² ± 2ab + b²; a²−b² = (a+b)(a−b).',
      ),
    ],
  },
  {
    id: 'c9-math-number-systems',
    title: 'Number Systems',
    grade: 9,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'Rational… and beyond',
        'Numbers you can write as p/q (q ≠ 0) are RATIONAL. Numbers that cannot are IRRATIONAL: √2 = 1.4142135… never ends and never repeats, and neither does π. Rational + irrational together make the REAL numbers.',
      ),
      textCard(
        'c2',
        'Repeating decimals & rationalising',
        'Recurring decimals are rational: 0.142857142857… = 1/7. To rationalise a denominator, multiply top and bottom by the root: 1/√2 × √2/√2 = √2/2. Now the denominator is a whole number.',
      ),
      quizCard(
        'c3',
        'q1',
        'Which of these is an irrational number?',
        ['4/7', '0.5', '√5', '−3'],
        2,
        '√5 cannot be written as p/q — its decimal expansion is non-terminating and non-repeating.',
      ),
      quizCard(
        'c4',
        'q2',
        '0.142857142857… (repeating) is…',
        ['Irrational', 'Rational', 'Not a real number', 'Negative'],
        1,
        'A recurring decimal equals a fraction (here 1/7), so it is rational — despite being infinite.',
      ),
      quizCard(
        'c5',
        'q3',
        'Rationalise: 2/√3 = ?',
        ['√3/2', '2√3/3', '2/3', '√3'],
        1,
        'Multiply by √3/√3: (2√3)/(√3·√3) = 2√3/3. Denominator is now the integer 3.',
      ),
      summaryCard(
        'c6',
        'Real numbers = rational (p/q) + irrational (√2, π). Recurring decimals are rational; rationalise by multiplying by the conjugate root.',
      ),
    ],
  },
  {
    id: 'c9-math-lines-angles',
    title: 'Lines and Angles',
    grade: 9,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'Pairs of angles',
        'Complementary angles add to 90°; supplementary angles add to 180°. When two lines cross, vertically opposite angles are equal, and angles on a straight line (a linear pair) add to 180°.',
      ),
      textCard(
        'c2',
        'Parallel lines and a transversal',
        'When a transversal cuts two parallel lines: corresponding angles are equal, alternate interior angles are equal, and co-interior angles add to 180°. Conversely, if any of these holds, the lines are parallel. And every triangle\u2019s angles add to 180°.',
      ),
      quizCard(
        'c3',
        'q1',
        'What is the complement of 65°?',
        ['25°', '115°', '35°', '125°'],
        0,
        'Complementary angles sum to 90°: 90 − 65 = 25°.',
      ),
      quizCard(
        'c4',
        'q2',
        'Two lines cut by a transversal have equal alternate interior angles. What are the lines?',
        ['Always perpendicular', 'Parallel', 'Intersecting', 'Cannot tell'],
        1,
        'Equal alternate interior angles is the test for parallel lines.',
      ),
      quizCard(
        'c5',
        'q3',
        'Two angles of a triangle are 60° and 70°. The third is…',
        ['50°', '60°', '70°', '130°'],
        0,
        'Angles of a triangle sum to 180°: 180 − (60 + 70) = 50°.',
      ),
      summaryCard(
        'c6',
        'Vertical angles equal; linear pair = 180°. Parallel lines: equal corresponding & alternate angles, co-interior = 180°. Triangle sum = 180°.',
      ),
    ],
  },

  // ---------------------------------------------------------------- Science
  {
    id: 'c9-sci-matter-surroundings',
    title: 'Matter in Our Surroundings',
    grade: 9,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'What is matter?',
        'Anything that has mass and occupies space is matter. Matter is made of tiny particles with spaces between them, moving constantly, and attracting each other. Solids hold their shape; liquids take the container\u2019s shape; gases spread everywhere.',
      ),
      textCard(
        'c2',
        'Changing state',
        'Melting (solid→liquid), boiling (liquid→gas), condensation (gas→liquid), freezing (liquid→solid), and sublimation (solid→gas directly, like camphor). EVAPORATION happens at any temperature from the surface and causes COOLING — faster moving particles escape, leaving cooler ones behind.',
      ),
      quizCard(
        'c3',
        'q1',
        'In which state is the inter-particle force STRONGEST?',
        ['Gas', 'Liquid', 'Solid', 'Plasma'],
        2,
        'Particles of a solid are tightly packed by strong forces, which is why solids keep their shape.',
      ),
      quizCard(
        'c4',
        'q2',
        'Camphor disappears without melting. This is…',
        ['Boiling', 'Sublimation', 'Condensation', 'Evaporation'],
        1,
        'Solid → gas directly is sublimation. Camphor and dry ice (solid CO₂) do this.',
      ),
      quizCard(
        'c5',
        'q3',
        'Why does evaporation cause cooling?',
        ['It uses up all the oxygen', 'The fastest particles escape, leaving slower, cooler ones', 'Cold air rushes in', 'The liquid freezes'],
        1,
        'The most energetic particles leave the surface, so the average energy (temperature) of what remains is lower.',
      ),
      summaryCard(
        'c6',
        'Matter = particles with spaces, motion and force. States change via melting, boiling, condensation, freezing, sublimation. Evaporation cools.',
      ),
    ],
  },
  {
    id: 'c9-sci-motion',
    title: 'Motion',
    grade: 9,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'Distance vs displacement',
        'Distance is the full path length (scalar). Displacement is the straight-line change in position (vector). Your bus takes 8 km along a winding road (distance) but the displacement may be only 5 km.',
      ),
      textCard(
        'c2',
        'Speed, velocity, acceleration',
        'Speed = distance ÷ time (scalar). Velocity = displacement ÷ time (vector). Acceleration = change in velocity ÷ time. For uniform acceleration: v = u + at, s = ut + ½at², and v² = u² + 2as. The slope of a distance–time graph gives speed; the slope of a velocity–time graph gives acceleration.',
      ),
      quizCard(
        'c3',
        'q1',
        'What is the SI unit of velocity?',
        ['km/h', 'metre/second', 'metre', 'newton'],
        1,
        'Velocity measures displacement per second: metre/second (m/s).',
      ),
      quizCard(
        'c4',
        'q2',
        'A car speeds up from 0 to 20 m/s in 5 seconds. Its acceleration is…',
        ['4 m/s²', '20 m/s²', '100 m/s²', '0.25 m/s²'],
        0,
        'Acceleration = (v − u) ÷ t = (20 − 0) ÷ 5 = 4 m/s².',
      ),
      quizCard(
        'c5',
        'q3',
        'Which of these is a VECTOR quantity?',
        ['Distance', 'Speed', 'Displacement', 'Time'],
        2,
        'Vectors have direction too — displacement brings in where you end up. Distance and speed have no direction.',
      ),
      summaryCard(
        'c6',
        'v = u + at, s = ut + ½at², v² = u² + 2as. Velocity is speed with direction; acceleration is change of velocity over time.',
      ),
    ],
  },
  {
    id: 'c9-sci-atoms-molecules',
    title: 'Atoms and Molecules',
    grade: 9,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'The building blocks',
        'An atom is the smallest particle of an element; molecules form when atoms join. Two laws rule here: the LAW OF CONSERVATION OF MASS (mass is neither created nor destroyed) and the LAW OF CONSTANT PROPORTIONS (a compound always has the same ratio of elements).',
      ),
      textCard(
        'c2',
        'Weighing atoms',
        'Atomic mass is measured in atomic mass units (u); 1 u = 1/12 the mass of a carbon-12 atom. Symbols make formulas: H₂O, CO₂, NaCl. The MOLE links atoms to real life: 1 mole = 6.022 × 10²³ particles — the Avogadro number.',
      ),
      quizCard(
        'c3',
        'q1',
        'What is the chemical formula of a common salt crystal?',
        ['NaO', 'NaCl', 'NaOH', 'KCl'],
        1,
        'Sodium chloride is NaCl — one sodium atom, one chlorine atom.',
      ),
      quizCard(
        'c4',
        'q2',
        'The Avogadro number is…',
        ['6.022 × 10²³', '3 × 10⁸', '1.6 × 10⁻¹⁹', '22.4'],
        0,
        'One mole of any substance holds 6.022 × 10²³ particles.',
      ),
      quizCard(
        'c5',
        'q3',
        'How many atoms are in one molecule of CO₂?',
        ['2', '3', '4', '6'],
        1,
        'CO₂ = 1 carbon + 2 oxygen = 3 atoms per molecule.',
      ),
      summaryCard(
        'c6',
        'Atoms → molecules → compounds. Mass and proportions are conserved. 1 mole = 6.022 × 10²³ particles.',
      ),
    ],
  },

  // -------------------------------------------------------------------- SST
  {
    id: 'c9-sst-democracy',
    title: 'Democracy: What and Why',
    grade: 9,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'Rule by the people',
        'Democracy is a government of the people, by the people, for the people. In practice, people elect their rulers in free and fair elections. India\u2019s voting age is 18 — every adult citizen gets one vote, equal to every other.',
      ),
      textCard(
        'c2',
        'Why it works',
        'Democracy makes rulers accountable: they can be voted out. It protects citizens\u2019 dignity and follows the rule of law. Two key features: decisions involve discussion, debate and public opinion, and an independent judiciary checks the government\u2019s power.',
      ),
      quizCard(
        'c3',
        'q1',
        'In India, you become eligible to vote at age…',
        ['16', '18', '21', '25'],
        1,
        'Universal adult franchise gives every citizen aged 18+ the right to vote — regardless of wealth, gender or caste.',
      ),
      quizCard(
        'c4',
        'q2',
        'Which is a defining feature of democracy?',
        ['Rulers are chosen by the people', 'Rulers are chosen by the army', 'One family rules forever', 'People must obey without choice'],
        0,
        'Free and fair elections, with rulers the people can replace, are the heart of democracy.',
      ),
      quizCard(
        'c5',
        'q3',
        'Why must decisions in a democracy involve discussion?',
        ['It slows everything down', 'It respects the views of the people who will be affected', 'It is cheaper', 'Only experts decide better'],
        1,
        'Debate and deliberation let many voices be heard before a majority decision is taken.',
      ),
      summaryCard(
        'c6',
        'Democracy = accountable, elected government with free & fair elections, rule of law, and an independent judiciary.',
      ),
    ],
  },
  {
    id: 'c9-sst-climate',
    title: 'Climate of India',
    grade: 9,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'Weather vs climate',
        'WEATHER is the day-to-day state of the atmosphere. CLIMATE is the average weather over a long period. India has a monsoon-type climate. Key factors: latitude, altitude, pressure and winds, distance from the sea, and relief (mountains).',
      ),
      textCard(
        'c2',
        'The monsoon',
        'The monsoon is a seasonal reversal of wind direction. The southwest summer monsoon (June–September) brings most of India\u2019s rain. Rainfall varies hugely: Mawsynram in Meghalaya is among the wettest places on Earth, while the Rajasthan desert receives very little.',
      ),
      quizCard(
        'c3',
        'q1',
        'The southwest monsoon brings rain to India in which period?',
        ['December–February', 'June–September', 'October–November', 'All year'],
        1,
        'The southwest monsoon blows moisture-laden from the ocean from June to September.',
      ),
      quizCard(
        'c4',
        'q2',
        'Which of these places receives extremely heavy rainfall?',
        ['Mawsynram (Meghalaya)', 'Jaisalmer (Rajasthan)', 'Leh (Ladakh)', 'Delhi'],
        0,
        'Mawsynram receives some of the highest rainfall in the world — over 11,000 mm a year.',
      ),
      quizCard(
        'c5',
        'q3',
        'The average weather of a place over a LONG period is called its…',
        ['Weather', 'Climate', 'Monsoon', 'Forecast'],
        1,
        'Climate describes long-term patterns; weather describes what is happening today.',
      ),
      summaryCard(
        'c6',
        'India\u2019s monsoon climate: southwest monsoon rains June–September. Factors: latitude, altitude, winds, distance from sea, relief.',
      ),
    ],
  },
  {
    id: 'c9-sst-food-security',
    title: 'Food Security in India',
    grade: 9,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'Food for everyone, always',
        'Food security means food is AVAILABLE, AFFORDABLE and ACCESSIBLE to all people at all times. It requires enough production, enough money to buy, and smooth distribution. The most food-insecure are landless labourers, casual workers, and tribal and SC/ST households.',
      ),
      textCard(
        'c2',
        'Buffer stock & the PDS',
        'The government buys grain from farmers at a Minimum Support Price (MSP) and stores it as BUFFER STOCK. Through the Public Distribution System (PDS), this grain reaches ration shops, where families buy it at subsidised prices. Together these protected India from famine after Independence.',
      ),
      quizCard(
        'c3',
        'q1',
        'What is the Public Distribution System (PDS)?',
        ['Grain sold at subsidised prices through ration shops', 'A chain of expensive restaurants', 'A system to import food', 'An export scheme'],
        0,
        'The PDS distributes buffer-stock grain at fair prices through fair price (ration) shops.',
      ),
      quizCard(
        'c4',
        'q2',
        'The Minimum Support Price (MSP) exists to…',
        ['Guarantee farmers a base price for their crops', 'Make food expensive', 'Reduce the number of farmers', 'Tax agricultural income'],
        0,
        'MSP assures farmers a fair price and encourages food-grain production.',
      ),
      quizCard(
        'c5',
        'q3',
        'Which does food security require?',
        ['Only availability of food', 'Availability + affordability + access', 'Only high food prices', 'Only imports'],
        1,
        'Food must exist, people must be able to afford it, and they must be able to reach it. All three.',
      ),
      summaryCard(
        'c6',
        'Food security = availability + affordability + access for all, at all times. Buffer stock + MSP + PDS make it work.',
      ),
    ],
  },

  // --------------------------------------------------------------- English
  {
    id: 'c9-en-reported-speech',
    title: 'Reported Speech',
    grade: 9,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        'Quoting and reporting',
        'DIRECT speech uses exact words in quotes: He said, "I am busy." REPORTED (indirect) speech retells them: He said that he was busy. When we report, tenses usually step BACK one step.',
      ),
      textCard(
        'c2',
        'The three big shifts',
        '(1) Tense backsteps: am→was, will→would, is cooking→was cooking. (2) Pronouns change: "I" becomes he/she. (3) Time words change: now→then, today→that day, tomorrow→the next day. Commands become told/asked + to-verb; questions use asked + if/whether.',
      ),
      quizCard(
        'c3',
        'q1',
        'Report: He said, "I am busy."',
        ['He said that I am busy.', 'He said that he was busy.', 'He said that he is busy.', 'He says that he busy.'],
        1,
        'am backsteps to was and the pronoun changes: He said that he was busy.',
      ),
      quizCard(
        'c4',
        'q2',
        'Report: She asked, "Where are you going?"',
        ['She asked where I was going.', 'She asked where are you going.', 'She asked where I am going.', 'She asked was I going where.'],
        0,
        'Questions become embedded with normal word order: asked + where + subject + past tense.',
      ),
      quizCard(
        'c5',
        'q3',
        'Report: The teacher said, "Sit down."',
        ['The teacher said sit down.', 'The teacher told us to sit down.', 'The teacher said that we sat.', 'The teacher told that sit down.'],
        1,
        'Commands use told + to-infinitive: told us to sit down.',
      ),
      summaryCard(
        'c6',
        'Reporting backsteps tenses, changes pronouns and time words; commands use told + to-verb, questions use asked + if/whether.',
      ),
    ],
  },
  {
    id: 'c9-en-conditionals',
    title: 'Conditional Sentences',
    grade: 9,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        "What happens if…?",
        'Conditionals pair a condition (if-clause) with a result. ZERO conditional states facts: If you heat ice, it melts. FIRST conditional talks about likely future: If it rains, we will cancel the match.',
      ),
      textCard(
        'c2',
        'Unreal situations',
        'SECOND conditional imagines unreal presents: If I were you, I would ask for help (past tense + would). THIRD conditional imagines unreal pasts: If I had studied, I would have passed. Don\u2019t mix: the if-clause of second/third forms never takes would.',
      ),
      quizCard(
        'c3',
        'q1',
        'Which conditional is this? "If it rains, we will stay at home."',
        ['Zero', 'First', 'Second', 'Third'],
        1,
        'Real future possibility → first conditional: if + present, will + verb.',
      ),
      quizCard(
        'c4',
        'q2',
        'Complete: If I ___ enough time, I would help you.',
        ['have', 'had', 'will have', 'would have'],
        1,
        'Second conditional uses the past form in the if-clause: had.',
      ),
      quizCard(
        'c5',
        'q3',
        'Complete: If you ___ water to 100 °C, it boils.',
        ['heat', 'will heat', 'heated', 'would heat'],
        0,
        'Zero conditional (scientific fact): if + present, present.',
      ),
      summaryCard(
        'c6',
        'Zero: facts (If you heat ice, it melts). First: real future (if + present, will). Second: unreal present (if + past, would). Third: unreal past (if + had, would have).',
      ),
    ],
  },
  {
    id: 'c9-en-passive-voice',
    title: 'Active and Passive Voice',
    grade: 9,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        'Who does the action?',
        'ACTIVE voice: the subject acts — The cat drinks milk. PASSIVE voice: the subject receives — Milk is drunk by the cat. The passive is formed with be + past participle (drunk, written, seen).',
      ),
      textCard(
        'c2',
        'How to switch',
        'Active → passive: (1) object becomes subject, (2) use the same tense of be, (3) main verb becomes past participle. The cat drinks milk → Milk is drunk by the cat. The cat drank milk → Milk was drunk by the cat.',
      ),
      quizCard(
        'c3',
        'q1',
        'Passive of "The chef cooks dinner.":',
        ['Dinner is cooked by the chef.', 'Dinner was cooked by the chef.', 'The chef is cooked by dinner.', 'Dinner cooks the chef.'],
        0,
        'Object (dinner) becomes subject; present be = is; cook → cooked.',
      ),
      quizCard(
        'c4',
        'q2',
        'Active of "The ball was hit by Ravi.":',
        ['The ball hits Ravi.', 'Ravi was hit by the ball.', 'Ravi hit the ball.', 'Ravi is hitting by the ball.'],
        2,
        'Doer (Ravi) becomes subject; past tense hit stays hit.',
      ),
      quizCard(
        'c5',
        'q3',
        'Passive of "Ronit wrote a letter.":',
        ['A letter writes Ronit.', 'A letter was written by Ronit.', 'A letter is written by Ronit.', 'Ronit was written by a letter.'],
        1,
        'Object (a letter) becomes subject; past be = was; write → written.',
      ),
      summaryCard(
        'c6',
        'Active: subject acts. Passive: subject receives — be + past participle. The active object becomes the passive subject.',
      ),
    ],
  },
];