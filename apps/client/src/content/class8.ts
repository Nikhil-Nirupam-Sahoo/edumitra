/**
 * Class 8 syllabus — Math, Science, Social Science, English.
 * Hand-written NCERT-aligned micro-lessons: text → quiz (with explanation) →
 * summary, so every tap teaches something. Content is English-language; the UI
 * chrome translates to en/hi/ta.
 */

import { quizCard, summaryCard, textCard, type SeedLesson } from './types';

export const CLASS_8_LESSONS: SeedLesson[] = [
  // ------------------------------------------------------------------ Math
  {
    id: 'c8-math-rational-numbers',
    title: 'Rational Numbers',
    grade: 8,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'What is a rational number?',
        'A number written as p/q, where p and q are integers and q is not 0, is a rational number. Examples: 4/5, -3/7, 0 (because 0 = 0/1). Every integer and every fraction is rational — but √2 is not, since no integer pair makes √2 = p/q.',
      ),
      textCard(
        'c2',
        'Standard form & numbers between',
        'A rational number is in standard form when its denominator is positive and p, q share no common factor: 4/6 becomes 2/3. A beautiful fact: between any two rational numbers there are INFINITELY many rational numbers — you can always find more.',
      ),
      quizCard(
        'c3',
        'q1',
        'Which of these is a rational number?',
        ['√2', 'π', '3/4', 'None of these'],
        2,
        '3/4 = 0.75 can be written as the ratio of two integers. √2 and π cannot be written as p/q.',
      ),
      quizCard(
        'c4',
        'q2',
        'How many rational numbers lie between 1/4 and 1/2?',
        ['One', 'Two', 'Ten', 'Infinitely many'],
        3,
        'Between any two rational numbers there are infinitely many rational numbers, e.g. 3/8, 5/16, 9/32…',
      ),
      quizCard(
        'c5',
        'q3',
        'What is 10/25 in standard form?',
        ['10/25', '2/5', '5/2', '0.4/1'],
        1,
        'Divide numerator and denominator by their HCF, 5: 10÷5 = 2 and 25÷5 = 5. Standard form is 2/5.',
      ),
      summaryCard(
        'c6',
        'A rational number is p/q with q ≠ 0. Standard form divides out common factors. Between any two rationals, infinitely many more exist.',
      ),
    ],
  },
  {
    id: 'c8-math-linear-equations',
    title: 'Linear Equations in One Variable',
    grade: 8,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'Balance the two sides',
        "An equation is a statement that two sides are equal, like 2x + 3 = 9. Solving means finding the value of x that keeps the balance true. Whatever you do to one side, do the SAME to the other — that's the golden rule.",
      ),
      textCard(
        'c2',
        'Moving terms across (=)',
        "To solve 2x + 3 = 9: subtract 3 from both sides → 2x = 6, then divide both sides by 2 → x = 3. Moving a term to the other side with its sign changed (transposition) does the same job faster: +3 becomes −3.",
      ),
      quizCard(
        'c3',
        'q1',
        'Solve: 3x = 15',
        ['x = 3', 'x = 5', 'x = 12', 'x = 45'],
        1,
        'Divide both sides by 3: 3x ÷ 3 = 15 ÷ 3 = 5.',
      ),
      quizCard(
        'c4',
        'q2',
        'Ravi thinks of a number. When he adds 7, he gets 12. What is the number?',
        ['5', '7', '19', '84'],
        0,
        'Let the number be x. x + 7 = 12 → x = 12 − 7 = 5.',
      ),
      quizCard(
        'c5',
        'q3',
        'Solve: 2(x + 3) = 10',
        ['x = 1', 'x = 2', 'x = 3.5', 'x = 7'],
        1,
        'Divide both sides by 2 → x + 3 = 5 → x = 2.',
      ),
      summaryCard(
        'c6',
        'An equation is a balance. Add, subtract, multiply or divide by the same number on both sides to find x.',
      ),
    ],
  },
  {
    id: 'c8-math-mensuration',
    title: 'Mensuration: Area & Volume',
    grade: 8,
    subject: 'math',
    cards: [
      textCard(
        'c1',
        'Measuring around and inside',
        'Mensuration measures shapes. Perimeter is length around the edge; area is the space inside (square units); volume is the space inside a solid (cubic units). For a cuboid: volume = length × breadth × height, and surface area = 2(lb + bh + lh).',
      ),
      textCard(
        'c2',
        'Trapezium & rhombus',
        'A trapezium has one pair of parallel sides: area = ½ × (sum of parallel sides) × height = ½(a + b)h. A rhombus has equal sides and diagonals that cut at right angles: area = ½ × d₁ × d₂.',
      ),
      quizCard(
        'c3',
        'q1',
        'A trapezium has parallel sides 6 cm and 8 cm, and height 4 cm. Its area is?',
        ['28 cm²', '56 cm²', '14 cm²', '48 cm²'],
        0,
        'Area = ½ × (6 + 8) × 4 = ½ × 14 × 4 = 28 cm².',
      ),
      quizCard(
        'c4',
        'q2',
        'A cuboid is 2 m × 3 m × 4 m. Its volume is?',
        ['9 m³', '24 m³', '52 m³', '12 m³'],
        1,
        'Volume of a cuboid = l × b × h = 2 × 3 × 4 = 24 m³.',
      ),
      quizCard(
        'c5',
        'q3',
        'A cube has edge 5 cm. Its volume is?',
        ['25 cm³', '125 cm³', '150 cm³', '15 cm³'],
        1,
        'Volume of a cube = side³ = 5 × 5 × 5 = 125 cm³.',
      ),
      summaryCard(
        'c6',
        'Volume of cuboid = l × b × h; cube = side³. Trapezium area = ½(a + b)h; rhombus area = ½d₁d₂.',
      ),
    ],
  },

  // ---------------------------------------------------------------- Science
  {
    id: 'c8-sci-force-pressure',
    title: 'Force and Pressure',
    grade: 8,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'Push or pull that changes things',
        'A force is a push or a pull. It can change the speed, direction or shape of an object. The SI unit of force is the newton (N). Forces may be contact (push, friction, muscular) or non-contact (gravity, magnetic, electrostatic) — no touching needed.',
      ),
      textCard(
        'c2',
        'Pressure = force ÷ area',
        'Pressure is the force acting on a unit area: Pressure = Force ÷ Area. A smaller area gives MORE pressure — that is why a sharp knife cuts easily, and why school bags have wide straps (less pressure on shoulders). Liquids and gases press in ALL directions.',
      ),
      quizCard(
        'c3',
        'q1',
        'What is the SI unit of force?',
        ['Pascal', 'Newton', 'Joule', 'Watt'],
        1,
        'Force is measured in newtons (N), after Sir Isaac Newton.',
      ),
      quizCard(
        'c4',
        'q2',
        'Why does a sharp knife cut easily?',
        ['It is made of steel', 'Its edge has a very small area, so pressure is high', 'It is heavy', 'It is cool'],
        1,
        'Smaller area under the same force means greater pressure — Pressure = Force ÷ Area.',
      ),
      quizCard(
        'c5',
        'q3',
        'Gravitational force is a ___ force.',
        ['Contact', 'Muscular', 'Non-contact', 'Frictional'],
        2,
        'Gravity pulls objects together from a distance — no contact needed.',
      ),
      summaryCard(
        'c6',
        'Force = push or pull (unit: newton). Pressure = force ÷ area; smaller area → bigger pressure. Gravity is a non-contact force.',
      ),
    ],
  },
  {
    id: 'c8-sci-combustion-flame',
    title: 'Combustion and Flame',
    grade: 8,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'Burning needs three things',
        'Combustion is a chemical reaction where a substance reacts with oxygen and releases heat (and often light). Three things are always needed: FUEL, OXYGEN, and the ignition temperature (the minimum temperature at which a fuel catches fire).',
      ),
      textCard(
        'c2',
        'Flames, fuels and calorific value',
        'Combustion can be rapid, spontaneous or an explosion. A candle flame has three zones; the outermost blue zone is the hottest and fully burns the fuel. Fuels differ in calorific value (heat per kg) — a good fuel has high calorific value, is easy to store and burns without much smoke.',
      ),
      quizCard(
        'c3',
        'q1',
        'What are the three requirements of combustion?',
        ['Heat, light, sound', 'Fuel, oxygen, ignition temperature', 'Air, water, heat', 'Wood, coal, petrol'],
        1,
        'No oxygen → no burning. No fuel → nothing to burn. Below ignition temperature → no fire.',
      ),
      quizCard(
        'c4',
        'q2',
        'Which zone of a candle flame is the hottest?',
        ['Innermost zone', 'Middle luminous zone', 'Outermost blue zone', 'All are the same'],
        2,
        'The outermost zone has the most oxygen, so the fuel burns completely and the temperature is highest.',
      ),
      quizCard(
        'c5',
        'q3',
        'Which of these is a solid fuel?',
        ['Petrol', 'Coal', 'CNG', 'Kerosene'],
        1,
        'Coal is a solid fossil fuel. Petrol and kerosene are liquids; CNG is a gas.',
      ),
      summaryCard(
        'c6',
        'Combustion needs fuel + oxygen + ignition temperature. The outer blue zone of a flame is hottest. Good fuels burn clean and give lots of heat.',
      ),
    ],
  },
  {
    id: 'c8-sci-microorganisms',
    title: 'Microorganisms: Friends and Foes',
    grade: 8,
    subject: 'science',
    cards: [
      textCard(
        'c1',
        'Tiny living things all around us',
        'Microorganisms are living organisms too small to see with the naked eye — you need a microscope. They include bacteria, fungi, protozoa and some algae; viruses are also studied here though they need a host to multiply.',
      ),
      textCard(
        'c2',
        'Helpful AND harmful',
        'Microbes help us: Lactobacillus turns milk into curd; yeast makes bread rise and ferments idli batter; Rhizobium (in the roots of legumes) fixes nitrogen; Penicillium gave us the antibiotic penicillin. They also decompose waste. But some cause diseases and spoil food — control them by salting, sugaring, oiling or pasteurisation (heating milk to 72°C).',
      ),
      quizCard(
        'c3',
        'q1',
        'Which microorganism helps milk turn into curd?',
        ['Yeast', 'Lactobacillus (a bacterium)', 'Virus', 'Algae'],
        1,
        'Lactobacillus bacteria convert lactose into lactic acid, which thickens milk into curd.',
      ),
      quizCard(
        'c4',
        'q2',
        'Which bacterium fixes nitrogen in the roots of leguminous plants?',
        ['Rhizobium', 'Salmonella', 'Spirulina', 'E. coli'],
        0,
        'Rhizobium forms nodules on roots and converts atmospheric nitrogen into a form plants can use.',
      ),
      quizCard(
        'c5',
        'q3',
        'What is pasteurisation?',
        ['Freezing food permanently', 'Heating milk to kill microbes', 'Adding salt to meat', 'Drying food in the sun'],
        1,
        'Pasteurisation heats milk to about 72°C (for a short time) to destroy harmful microbes.',
      ),
      summaryCard(
        'c6',
        'Microbes are our friends (curd, bread, nitrogen, antibiotics) and sometimes foes. Preservation: salting, sugar, oil, pasteurisation.',
      ),
    ],
  },

  // -------------------------------------------------------------------- SST
  {
    id: 'c8-sst-resources',
    title: 'Resources',
    grade: 8,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'Anything that satisfies a need',
        'A resource is anything that satisfies a human need and has utility and value. Resources come from nature (air, water, soil, minerals) and from human skill. By exhaustibility they are renewable (water, solar, wind) or non-renewable (coal, petroleum, minerals).',
      ),
      textCard(
        'c2',
        'Ownership and conservation',
        'By ownership, resources are individual (a farmer\u2019s field), community (a village pond), national (roads, ports) or international (ocean water beyond 200 nautical miles). Resources are not unlimited — sustainable development means using them so future generations also get their share.',
      ),
      quizCard(
        'c3',
        'q1',
        'Which of these is a RENEWABLE resource?',
        ['Coal', 'Petroleum', 'Solar energy', 'Natural gas'],
        2,
        'Solar, wind and water are renewed by nature. Coal, petroleum and gas formed over millions of years — once gone, gone.',
      ),
      quizCard(
        'c4',
        'q2',
        'Minerals are classified as ___ resources.',
        ['Renewable', 'Non-renewable', 'Biotic', 'Artificial'],
        1,
        'Minerals take millions of years to form, so they are non-renewable however carefully they are used.',
      ),
      quizCard(
        'c5',
        'q3',
        'A village pond is an example of a ___ resource.',
        ['Individual', 'Community', 'National', 'International'],
        1,
        'Resources accessible to all people of a community (ponds, grazing grounds, parks) are community-owned.',
      ),
      summaryCard(
        'c6',
        'Resources = need + utility + value. Renewable vs non-renewable; individual vs community vs national. Sustainable development protects the future.',
      ),
    ],
  },
  {
    id: 'c8-sst-agriculture',
    title: 'Agriculture',
    grade: 8,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'The primary activity',
        'Agriculture is growing crops and raising livestock — the oldest primary activity. Arable land grows crops. Farming can be subsistence (for the farmer\u2019s own family) or commercial (for the market).',
      ),
      textCard(
        'c2',
        'Kharif, Rabi and Zaid',
        'Crops follow the seasons. KHARIF crops are sown with the monsoon rains (June–September): rice, maize, cotton, jute. RABI crops are sown in winter (October–December): wheat, mustard, gram, peas. ZAID crops grow in the short summer between: watermelon, muskmelon, cucumber. India is among the world\u2019s largest producers of rice, wheat and sugarcane.',
      ),
      quizCard(
        'c3',
        'q1',
        'Wheat and mustard are sown in which season?',
        ['Kharif (rainy)', 'Rabi (winter)', 'Zaid (summer)', 'Monsoon'],
        1,
        'Wheat and mustard are rabi crops — sown after the rains, harvested in spring.',
      ),
      quizCard(
        'c4',
        'q2',
        'Farming where crops are grown mainly for sale in the market is called…',
        ['Subsistence farming', 'Commercial farming', 'Shifting farming', 'Garden farming'],
        1,
        'Commercial farming grows crops and livestock for the market to earn money.',
      ),
      quizCard(
        'c5',
        'q3',
        'Which crop is grown during the kharif season?',
        ['Wheat', 'Rice', 'Mustard', 'Gram'],
        1,
        'Rice is a kharif crop: it needs plenty of water from the monsoon rains.',
      ),
      summaryCard(
        'c6',
        'Agriculture = crops + livestock. Kharif (rains: rice, maize, cotton); Rabi (winter: wheat, mustard); Zaid (summer: watermelon).',
      ),
    ],
  },
  {
    id: 'c8-sst-constitution',
    title: 'The Indian Constitution',
    grade: 8,
    subject: 'sst',
    cards: [
      textCard(
        'c1',
        'The rule book of the country',
        'A constitution is a body of fundamental rules that a country agrees to follow. India\u2019s Constitution was adopted on 26 November 1949 and came into force on 26 January 1950. It was drafted by the Constituent Assembly; Dr. B. R. Ambedkar chaired the drafting committee.',
      ),
      textCard(
        'c2',
        'Why we need one — key features',
        'A constitution builds trust in a diverse country: majorities and minorities, rulers and ruled, all agree to its rules. Key features: federalism (two levels of government), parliamentary government, separation of powers (legislature, executive, judiciary), secularism, and Fundamental Rights — including equality, freedom, and protection against exploitation.',
      ),
      quizCard(
        'c3',
        'q1',
        'The Indian Constitution came into force on…',
        ['26 January 1950', '15 August 1947', '26 November 1949', '2 October 1950'],
        0,
        'Adopted on 26 Nov 1949, it took effect on Republic Day, 26 January 1950.',
      ),
      quizCard(
        'c4',
        'q2',
        'Who chaired the Drafting Committee of the Constitution?',
        ['Jawaharlal Nehru', 'Dr. B. R. Ambedkar', 'Mahatma Gandhi', 'Rajendra Prasad'],
        1,
        'Dr. B. R. Ambedkar led the drafting committee and is called the father of the Indian Constitution.',
      ),
      quizCard(
        'c5',
        'q3',
        'Which of these is a Fundamental Right in India?',
        ['Right to Equality', 'Right to Board a Bus', 'Right to Free Lunch', 'Right to Watch TV'],
        0,
        'Fundamental Rights protect every citizen: equality, freedom, protection against exploitation, freedom of religion, cultural rights and constitutional remedies.',
      ),
      summaryCard(
        'c6',
        'The Constitution (26 Jan 1950) is India\u2019s rule book: federalism, separation of powers, secularism and Fundamental Rights.',
      ),
    ],
  },

  // --------------------------------------------------------------- English
  {
    id: 'c8-en-tenses',
    title: 'Tenses: When Things Happen',
    grade: 8,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        'Present · Past · Future',
        'Tenses tell us WHEN an action happens. Present (she goes), past (she went), future (she will go). Each has simple, continuous and perfect forms: I play, I am playing, I have played.',
      ),
      textCard(
        'c2',
        'Choosing the right form',
        'Simple present = habits (She goes to school daily). Present continuous = happening now (She is going to school). Simple past = finished (She went yesterday). Present perfect = finished but connected to now (She has finished her homework). Future uses will/shall.',
      ),
      quizCard(
        'c3',
        'q1',
        'She ___ to school every day.',
        ['go', 'goes', 'going', 'gone'],
        1,
        'Habits use the simple present: with he/she/it, add -s → goes.',
      ),
      quizCard(
        'c4',
        'q2',
        'They ___ watching TV right now.',
        ['is', 'was', 'are', 'will'],
        2,
        '\u201Cright now\u201D = action in progress → present continuous: are watching.',
      ),
      quizCard(
        'c5',
        'q3',
        'He ___ finished his homework (the result matters now).',
        ['have', 'has', 'will', 'is having'],
        1,
        'Present perfect expresses a completed action with present relevance: has + past participle.',
      ),
      summaryCard(
        'c6',
        'Tenses show time: present, past, future — in simple, continuous and perfect forms (go, going, gone, has gone).',
      ),
    ],
  },
  {
    id: 'c8-en-active-passive',
    title: 'Active and Passive Voice',
    grade: 8,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        'Who does it? Or who gets it?',
        'In ACTIVE voice the subject does the action: The cat drinks milk. In PASSIVE voice the subject receives the action: Milk is drunk by the cat. The passive is built with be + past participle.',
      ),
      textCard(
        'c2',
        'Three steps to convert',
        'To change active → passive: (1) the object becomes the subject, (2) use the correct form of be in the SAME tense, (3) write the main verb as a past participle. The cat drinks milk → Milk is drunk by the cat.',
      ),
      quizCard(
        'c3',
        'q1',
        'Convert to passive: The chef cooks dinner.',
        ['Dinner is cooked by the chef.', 'Dinner was cooked by the chef.', 'The chef is cooked by dinner.', 'Dinner cooks the chef.'],
        0,
        'Object (dinner) becomes subject; present tense be = is; cook → cooked. Dinner is cooked by the chef.',
      ),
      quizCard(
        'c4',
        'q2',
        'Convert to active: The ball was hit by Ravi.',
        ['The ball hits Ravi.', 'Ravi was hit by the ball.', 'Ravi hit the ball.', 'Ravi is hitting by the ball.'],
        2,
        'The doer (Ravi) becomes subject; past tense hit stays hit. Ravi hit the ball.',
      ),
      quizCard(
        'c5',
        'q3',
        'Convert to passive: Ronit wrote a letter.',
        ['A letter writes Ronit.', 'A letter was written by Ronit.', 'A letter is written by Ronit.', 'Ronit was written by a letter.'],
        1,
        'Object (a letter) becomes subject; past tense be = was; write → written.',
      ),
      summaryCard(
        'c6',
        'Active: subject acts. Passive: subject receives — be + past participle. The object of the active becomes the subject.',
      ),
    ],
  },
  {
    id: 'c8-en-comprehension',
    title: 'Reading Comprehension',
    grade: 8,
    subject: 'english',
    cards: [
      textCard(
        'c1',
        'Finding the main idea',
        'Good readers ask questions while they read. The MAIN IDEA is the most important point the author makes. Topic sentences (often the first sentence of a paragraph) usually state it. Supporting details give examples, reasons or evidence.',
      ),
      textCard(
        'c2',
        'Inferring and vocabulary from context',
        'Sometimes the text does not say something directly — you must INFER it from clues. Words you do not know can often be guessed from the surrounding words (context clues). Read a little before and after the unknown word.',
      ),
      quizCard(
        'c3',
        'q1',
        'The main idea of a paragraph is usually found in…',
        ['The last word', 'The topic sentence', 'The title only', 'A random line'],
        1,
        'The topic sentence (often the first) states the main point; the rest supports it.',
      ),
      quizCard(
        'c4',
        'q2',
        'If you do not know a word, the BEST clue is…',
        ['Its length', 'The words around it', 'The page number', 'The cover'],
        1,
        'Context clues — surrounding words — reveal meaning.',
      ),
      quizCard(
        'c5',
        'q3',
        'Inferring means…',
        ['Guessing randomly', 'Skipping the word', 'Using clues to reach a conclusion', 'Asking someone'],
        2,
        'To infer is to read between the lines using evidence in the text.',
      ),
      summaryCard(
        'c6',
        'Main idea = topic sentence. Infer = use clues. Unknown words = check context around them.',
      ),
    ],
  },
];