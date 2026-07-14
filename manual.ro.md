# Manual de utilizare — pdfcodes preview

Acest manual explică, pas cu pas, cum se folosește aplicația pentru a aranja
coduri (text) pe un fundal și a genera PDF-uri pregătite pentru **print** și
pentru **tăiere pe contur**.

---

## 1. Ce face aplicația

- Așezi unul sau mai multe **coduri** (text) peste un **fundal** (un card).
- Tai cardul pe un **contur** — o formă dintr-un fișier (**PDF sau SVG**) sau o
  **formă presetată** (cerc, dreptunghi rotunjit etc.).
- Vezi **în timp real** cum vor arăta cardurile, într-o previzualizare.
- Codurile (datele) pot fi **generate automat** sau încărcate dintr-un fișier
  **CSV** propriu.
- Obții la final unul sau două PDF-uri:
  - **Print** — cardurile cu fundal și text, așezate (impuse) pe pagină.
  - **Contur** — liniile de tăiere (pentru plotter/cutter).

Toate culorile sunt în **CMYK** (cum se tipărește), iar previzualizarea pe
ecran este o aproximare RGB a culorii de print.

---

## 2. Interfața generală

![Privire generală asupra interfeței](manual-assets/00-privire-generala.png)

Ecranul are două coloane:

- **Stânga** — panoul de configurare (se schimbă în funcție de pasul curent).
- **Dreapta** — **Previzualizarea** cardului și, după generare, **Rezultatul**.

Sus, în antet, găsești:

- Titlul aplicației.
- **Salvează setările (.zip)** — descarcă toate alegerile tale (vezi 2.2).
- Butoanele **↶ / ↷** — **Anulează / Refă** (echivalent Ctrl+Z / Ctrl+Shift+Z).
- Butonul **„Mod luminos” / „Mod întunecat”** — comută tema vizuală.

### 2.1 Pașii (asistentul / wizard)

Sub secțiunea „Presetări” există o bară cu **5 pași**, care trebuie parcurși în ordine:

1. **Fundal** — fundalul cardului (PDF, culoare simplă sau imagine generată).
2. **Contur** — forma de tăiere (fișier PDF/SVG sau formă presetată).
3. **Date** — sursa codurilor (generate automat sau dintr-un CSV).
4. **Coduri** — aspectul și poziționarea textului pe card.
5. **PDF** — generarea PDF-urilor de print și de contur.

Pașii se **deblochează pe rând**:

- **Fundal** este mereu disponibil.
- **Contur** se deblochează după ce ai configurat fundalul.
- **Date** se deblochează după fundal **și** contur.
- **Coduri** și **PDF** se deblochează după ce ai pregătit și datele.

Dacă un pas este blocat, apare un mesaj care îți spune ce mai ai de făcut.
Jos găsești butoanele de navigare **Înapoi / Continuă** și indicatorul „Pasul X din 5”.

### 2.2 Presetări (salvare și încărcare)

- **Salvează setările (.zip)** — buton în **antet** (sus), lângă butoanele de
  anulare/refacere. Descarcă un fișier `.zip` cu **toate** alegerile tale, inclusiv
  fundalul, conturul și fonturile folosite, plus o miniatură `thumbnail.png` a
  previzualizării (când există). Util pentru a relua munca mai târziu sau pe alt
  calculator.
- Secțiunea **„Presetări”** (pliabilă, sus) — **Încarcă setări (.zip sau .json)**
  reîncarcă o configurație salvată anterior.

---

## 3. Pasul 1 — Fundal

Aici stabilești **fundalul cardului** — imaginea (sau culoarea) pe care se
tipărește și peste care vei așeza codurile. Pasul e complet când există un
fundal valid; **forma de tăiere se stabilește separat, în Pasul 2 — Contur.**

![Pasul 1 — Fundal: un card PDF încărcat, cu dimensiunile detectate, reglajele și previzualizarea în dreapta](manual-assets/01-fundal.png)

*Ecranul „Fundal”: stânga — configurarea fundalului; dreapta — previzualizarea
cardului. Sus se văd antetul, bara cu cei 5 pași și secțiunea „Presetări”.*

Primul comutator, **Sursă**, alege de unde vine cardul. Sunt trei variante —
**Încarcă PDF**, **Simplu** și **Imagine** — iar sub el apar câmpuri diferite în
funcție de alegere.

### 3.1 Încarcă PDF

Folosești un PDF gata făcut care conține **un singur card** (nu o coală
întreagă).

![Sursă „Încarcă PDF”: fișierul, dimensiunile detectate, dimensiunile țintă și reglajele de rotire/oglindire](manual-assets/f1-print-upload.png)

- **PDF (un card)** — butonul **„Choose File”** deschide selectorul de fișiere.
  Dacă PDF-ul are mai multe pagini, alături (pe același rând) apare câmpul
  **Pagina (1–N)** pentru a alege pagina folosită.
- **Dimensiuni detectate** — banda albastră afișată imediat ce PDF-ul e citit.
  Arată dimensiunea reală a paginii în **mm** (și, în paranteză, în **puncte
  tipografice — pt**). Este informativă, nu o poți edita.
- **Lățime țintă (mm)** / **Înălțime țintă (mm)** — opțional. Pre-completate cu
  dimensiunea detectată; le poți modifica pentru a **redimensiona** cardul.
  Butonul **lacăt** păstrează proporția, iar butonul cu **săgeți** schimbă între
  ele lățimea și înălțimea (portret ⇄ peisaj). Codurile deja așezate își păstrează
  poziția **relativă**, deci nu trebuie rearanjate.
- **↻ Rotește 90°** — rotește fundalul cu 90° (indicatorul **„Rotație: …°”** arată
  unghiul curent).
- **Oglindire X** / **Oglindire Y** — răstoarnă fundalul pe orizontală / verticală.

### 3.2 Simplu

Generezi cardul direct în aplicație, fără un PDF — util pentru un simplu
dreptunghi colorat sau transparent.

![Sursă „Simplu”: lățime, înălțime și câmpul de culoare CMYK](manual-assets/f2-print-simple.png)

- **Lățime (mm)** / **Înălțime (mm)** — dimensiunile cardului generat (cu lacătul
  de proporție alături).
- **Culoare (opțional)** — culoarea de umplere, în **CMYK** (vezi secțiunea **6.4**
  pentru cum se folosește selectorul).
  - Bifează **„fără culoare”** (colțul din dreapta-sus) pentru un card **fără
    umplere** — transparent. Când e bifată, câmpurile CMYK dispar.

### 3.3 Imagine

Construiești fundalul dintr-o **imagine** (PNG, JPEG sau SVG), care este întinsă
peste card la dimensiunile țintă.

![Sursă „Imagine”: alegerea sursei imaginii (Fișier local / URL / Clipboard)](manual-assets/f7-print-imagine.png)

- **Sursă imagine** — de unde iei imaginea:
  - **Fișier local** — câmpul **Imagine (PNG, JPEG sau SVG)** deschide selectorul
    de fișiere.
  - **URL** — lipești o adresă și apeși **„Încarcă”**.
  - **Clipboard** — apeși **„📋 Lipește imaginea”**, `Ctrl+V` sau tragi o imagine
    în zona punctată.
- La un **SVG cu text** apare un avertisment: convertește textul în contururi
  (outline) înainte de încărcare.
- După încărcare apar **Lățime țintă (mm)** / **Înălțime țintă (mm)** (cu lacăt și
  schimbare), **↻ Rotește 90°** și **Oglindire X/Y**, la fel ca la PDF. Dacă
  imaginea are zone transparente, apare și **Culoare zone transparente** (alege o
  culoare de umplere sau „carouri” pentru a păstra transparența).

### 3.4 Poziționare (comun tuturor surselor)

Odată ce există un fundal, jos apare blocul **Poziționare**, care influențează
**doar fundalul** (nu forma de tăiere):

- **Mută fundalul** — activează tragerea fundalului direct în previzualizare
  (**Shift + tragere** blochează mișcarea pe o singură axă).
- **Decalaj X (mm)** / **Decalaj Y (mm)** — deplasează fundalul în cadrul cardului.
- **Rotație (grade)** — rotește fin fundalul (orice unghi, nu doar 90°).
- **Culoare zone libere** — culoarea cu care se umplu zonele rămase libere după
  deplasare/rotire; **„transparent”** le lasă goale.

> Conturul (forma de tăiere) nu se mai configurează aici, ci în **Pasul 2 —
> Contur** (secțiunea următoare).

---

## 4. Pasul 2 — Contur

Aici stabilești **conturul** — linia după care se taie cardul (pentru
plotter/cutter). Pasul e complet când există un contur valid. Conturul poate veni
dintr-un **fișier** propriu sau dintr-o **formă presetată**.

![Pasul 2 — Contur: o formă presetată (Cerc) peste card, cu reglajele conturului și previzualizarea în dreapta](manual-assets/02-contur.png)

*Ecranul „Contur”: forma de tăiere (aici un cerc) apare peste card în
previzualizare; „Întunecă exteriorul conturului” estompează zona care se aruncă.*

Primul comutator, **Sursă**, alege între **Încarcă PDF/SVG/PNG** și **Formă presetată**.

### 4.1 Încarcă PDF/SVG/PNG

Folosești propria linie de tăiere dintr-un fișier **PDF** sau **SVG**, ori o lași
**trasată automat** dintr-o **imagine transparentă** (**PNG** sau **JPEG**).

![Sursă „Încarcă PDF/SVG”: alegerea sursei fișierului (Fișier local / URL / Clipboard)](manual-assets/c1-contur-upload.png)

- **Sursă fișier** — de unde iei fișierul:
  - **Fișier local** — câmpul **PDF, SVG, PNG sau JPEG (opțional)** deschide
    selectorul de fișiere. Dacă PDF-ul are mai multe pagini, alături (pe același rând)
    apare **Pagina (1–N)**. Când refolosești PDF-ul de fundal, aplicația alege automat
    o **pagină diferită** de cea a fundalului și te anunță: *„Aplicația folosește
    automat pagina X din Y (diferită de pagina fundalului).”* — nota dispare de
    îndată ce alegi tu pagina.
  - **URL** — lipești o adresă și apeși **„Încarcă”**.
  - **Clipboard** — apeși **„📋 Lipește fișierul”**, `Ctrl+V` sau tragi un fișier
    PDF/SVG/PNG/JPEG (ori cod SVG sau o imagine) în zona punctată.
- La un **SVG cu text** apare un avertisment: convertește textul în contururi
  (outline) înainte de încărcare.
- **Dimensiunea conturului (nu a paginii)** — bifează pentru ca dimensiunea să fie
  cea a desenului, ignorând marginile goale ale paginii. Aliniază cu grijă
  decuparea la print (apare un avertisment cât timp e activă). *(Doar pentru
  PDF/SVG — la o imagine trasată conturul este deja dimensiunea desenului.)*

#### Trasare din imagine (PNG/JPEG)

Când încarci o **imagine transparentă**, aplicația **trasează automat** linia de
tăiere pe **conturul exterior** al pixelilor vizibili — exact acolo unde începe
transparența. Zonele **transparente din interior** devin **goluri** (se taie și ele).
Util pentru **stickere die-cut**: pui lucrarea ca imagine și obții conturul de tăiere
care o urmărește. Apare grupul **„Trasare din imagine”** cu:

- **Prag transparență (0–255)** — cât de opac trebuie să fie un pixel ca să conteze
  drept „plin” (marginea conturului). Un prag mai mic prinde și zonele
  semi-transparente; unul mai mare le ignoră.
- **Netezire contur** — cât de mult se netezește linia (scapă de „scările” de pixeli).
  Valori mici = linie mai fidelă pixelilor; valori mari = linie mai netedă.

Ambele reglaje **re-trasează** conturul pe loc, fără să-ți piardă dimensiunea sau
rotația. Dacă imaginea **nu are transparență** apare un mesaj și conturul devine
dreptunghiul imaginii. Pentru **bleed** (linie puțin în afara desenului), folosește
**Redesenează (+mm)** din reglajele de mai jos (4.3).

### 4.2 Formă presetată

Aplicația desenează singură conturul, pe baza dimensiunilor cardului.

- **Formă** — lista de forme: **Cerc**, **Elipsă**, **Dreptunghi**, **Dreptunghi cu
  colțuri rotunjite**, **Dreptunghi cu colțuri teșite**, **Inimă** și **Poligon**.
  În funcție de formă apar câmpuri suplimentare:
  - **Dreptunghi cu colțuri rotunjite** — **Raza colțurilor (mm)** și **Orientare**
    (**În afară** = colțuri rotunjite normale / **În interior** = colțuri „scobite”).
  - **Dreptunghi cu colțuri teșite** — **Teșire colțuri (mm)** (colțul tăiat drept).
  - **Poligon** — **Număr laturi** și opțiunea **Stea (vârfuri spre interior)**. Când
    **Stea** e bifată apar două reglaje suplimentare:
    - **Adâncime vârfuri (0.05–0.95)** — cât de adânc intră golurile stelei, ca fracțiune
      din raza exterioară. Valori mai mici = vârfuri mai lungi și mai ascuțite; mai mari =
      stea mai „plină”. Implicit urmărește automat numărul de laturi.
    - **Redimensionează doar vârfurile** — când e bifată, la redimensionarea conturului se
      mișcă **doar vârfurile exterioare**; miezul (inelul interior) rămâne la dimensiunea pe
      care o avea când ai bifat opțiunea. Astfel poți face steaua mai ascuțită mărind-o sau
      mai boantă micșorând-o, fără a scala tot desenul.
- Forma presetată are nevoie de un fundal cu dimensiuni cunoscute; altfel apare
  mesajul *„Încarcă întâi PDF-ul de fundal pentru a genera forma.”*

### 4.3 Reglaje contur (comune ambelor surse)

Odată ce conturul există, apar reglaje care se aplică atât fișierului încărcat, cât
și formei presetate:

![Reglaje contur: dimensiune, dimensiuni țintă, rotire, „Redesenează”, transparență și mod de combinare](manual-assets/c2-contur-shape.png)

- **Dimensiune** — dimensiunea curentă a conturului (informativ, în mm).
- **Lățime țintă (mm)** / **Înălțime țintă (mm)** — redimensionează conturul (cu
  **lacăt** de proporție și buton de **schimbare** lățime ⇄ înălțime). Cercul rămâne
  1:1.
- **↻ Rotește 90°** (cu indicatorul **„Rotație: …°”**) — rotește conturul cu 90°.
- **Rotație (grade)** — rotire fină, la orice unghi.
- **Redesenează (decalaj mm, + în afară / − în interior)** — decalează **întreaga
  linie de tăiere** (die-line) cu aceeași distanță: pozitiv o mărește (bleed),
  negativ o micșorează (margine de siguranță). `0` = neschimbat. La un decalaj
  diferit de 0, chiar sub acest reglaj apare, scos în evidență, rezultatul:
  *„→ Tăiere finală: W × H mm”*. Câmpurile „Lățime/Înălțime țintă” de deasupra
  rămân **conturul de bază** (fără decalaj), iar sub ele o notă îți amintește asta:
  *„Dimensiunile de mai sus sunt conturul de bază; redesenarea (+X mm) produce
  tăierea finală de mai jos.”* — astfel cele două numere nu par o nepotrivire.
- **Fără autointersectare** — apare la un **contur trasat din imagine** sau când
  **Redesenează** e activ. Bifează pentru ca traseul de tăiere să nu se
  **autointersecteze** (nu poți tăia fizic o linie care se suprapune singură):
  aplicația elimină nodurile care produc încrucișările, păstrând forma simplă.
  Util mai ales la un decalaj mare spre interior sau la forme cu concavități.
- **Decalaj X / Decalaj Y** — poziționează conturul în cadrul cardului; eticheta
  fiecărui câmp arată intervalul permis (ex. *„Decalaj X (0.0–12.5 mm)”*). Alături,
  butoanele **Centrează: ↔ Orizontal / ↕ Vertical**. Apar doar când conturul e mai
  mic decât fundalul; altfel un mesaj anunță că „conturul ocupă tot fundalul”.
- Conturul poate fi mutat și **direct în previzualizare**, la fel ca un cod (vezi
  6.3): **clic** pe el îl selectează (chenar animat „marching ants”), **tragerea**
  îl mută, **Shift + tragere** blochează mișcarea pe o singură axă, iar
  **săgețile** (← ↑ → ↓) îl deplasează fin cât timp previzualizarea are focus.
- **Transparență (0–1)** și **Mod combinare** — cât de vizibil e conturul peste
  fundal în previzualizare și modul de îmbinare (`normal`, `multiply`, `screen`,
  `overlay` etc.). Afectează **doar previzualizarea**.
- **Întunecă exteriorul conturului (doar previzualizare)** — estompează zona din
  afara tăieturii, ca să vezi ce păstrează conturul. Nu schimbă fișierul de tăiere.
- **Pulsează conturul (doar previzualizare)** — animă un contur luminos în jurul
  liniei de tăiere, ca să o găsești ușor pe un fundal încărcat. Este doar un ajutor
  vizual: nu schimbă fișierul de tăiere și nu apare în capturi.

---

## 5. Pasul 3 — Date

Aici stabilești **codurile** care vor apărea pe carduri. **Fiecare rând = un card.**
Pasul „Date” este și o poartă: pașii **Coduri** și **PDF** rămân blocați până când
datele sunt pregătite (vezi 5.4).

![Pasul 3 — Date: modul „Generează coduri”, taburile de coduri, blocul „Cod 1” și previzualizarea datelor](manual-assets/03-date.png)

*Modul „Generează coduri”: setezi numărul de rânduri și structura codului, apeși
„Generează CSV”, apoi vezi o previzualizare a primelor rânduri (și poți descărca
`codes.csv`).*

Primul comutator, **Mod sursă**, alege de unde vin codurile:

![Mod sursă: „Încarcă CSV” sau „Generează coduri”](manual-assets/s2-mode.png)

- **Încarcă CSV** — folosești un fișier CSV propriu (vezi 5.2).
- **Generează coduri** — aplicația creează CSV-ul după regulile tale (vezi 5.1).
  Este opțiunea selectată implicit.

### 5.1 Generează coduri

#### 5.1.1 Setări generale

![Număr de rânduri și separatorul dintre coduri](manual-assets/s2-generate-top.png)

- **Număr de rânduri** — câte carduri se generează (un rând = un card).
- **Separator între coduri pe rând** — caracterul care desparte codurile de pe
  **același** rând. Contează doar dacă un card afișează mai multe coduri (vezi
  5.1.4). Implicit este virgula `,`; poți pune un spațiu, `;`, `|` etc.

#### 5.1.2 Blocul „Cod” — structura unui cod

Codurile unui rând apar ca **taburi** rotunde („Cod 1”, „Cod 2”, …), urmate de
butonul **„+ Adaugă cod”**. Apasă pe un tab ca să-i deschizi setările — se editează
un singur cod odată. Fiecare cod se construiește după tiparul **prefix + cod + sufix**:

![Blocul „Cod 1” în modul „Generat aleator”](manual-assets/s2-cod-random.png)

- **Prefix (opțional)** / **Sufix (opțional)** — text fix adăugat **înainte** /
  **după** cod, lipit direct (fără spațiu — dacă vrei un spațiu, include-l tu în
  prefix/sufix).
- **Tip cod** — alege cum se produce partea variabilă a codului:
  - **Generat aleator** — afișează **Caractere** (set de simboluri: `Numeric`,
    `Alfabetic` sau `Alfanumeric (mixt)`) și **Lungime** (câte caractere are).
  - **Interval numeric** — afișează **Start interval** și **Pas**: codurile sunt
    numere consecutive (ex. start `1`, pas `1` → 1, 2, 3 …).
  - **Text fix** — afișează **Text**: același text pe fiecare rând (ex.
    `SPECIMEN`) — util ca etichetă sau filigran. Nu are completare și este
    exceptat de la verificarea unicității (vezi 5.1.5).

![Același bloc în modul „Interval numeric”: prefix „NR-”, completare cu zerouri](manual-assets/s2-cod-range.png)

#### 5.1.3 Completarea (padding)

Completarea aliniază codurile la o lungime fixă (util ca toate să arate la fel, ex.
`00001`, `00002`). Apare doar la **Generat aleator** și **Interval numeric** —
un „Text fix” nu se completează.

- **Completare**:
  - **Până la o lățime** — completează codul cu caracterele de umplutură până la
    **Lățime totală**. Ex.: cod `7` + umplutură `0` + lățime `5` → `00007`.
  - **Text fix adăugat** — adaugă pur și simplu caracterele de umplutură în față,
    fără o lățime-țintă.
- **Umplutură** — caracterul folosit la completare (de obicei `0`).
- **Lățime totală** — apare doar la „Până la o lățime”.

> Notă: dacă lățimea totală este **mai mică sau egală** cu lungimea codului,
> completarea nu are efect și apare un avertisment galben:

![Avertisment: lățimea totală ≤ lungimea codului](manual-assets/s2-padding-warning.png)

#### 5.1.4 Mai multe coduri pe rând

Butonul **„+ Adaugă cod”** adaugă un tab nou, deci **fiecare card va afișa mai
multe coduri**, despărțite de separatorul din 5.1.1. Când există cel puțin două
coduri, blocul activ are un buton **„Elimină”** care îl șterge.

![Două coduri pe rând: taburile „Cod 1” și „Cod 2”, cu blocul activ deschis](manual-assets/s2-multi-code.png)

#### 5.1.5 Unicitatea codurilor

Pentru codurile **generate aleator**, aplicația compară numărul de rânduri cerut
cu numărul de **combinații posibile** (dat de setul de caractere și de lungime):

- Dacă rândurile **se apropie** de numărul de combinații, apare un avertisment
  **galben**: codurile aleatoare nu garantează unicitatea, deci la acest volum vor
  apărea probabil duplicate.
- Dacă rândurile **depășesc** combinațiile, mesajul devine **roșu**, tabul codului
  primește semnul **⚠**, iar butonul „Generează CSV” se **dezactivează**. Mărește
  lungimea codului, schimbă setul de caractere sau folosește un interval numeric.

![Tabul roșu cu ⚠ și mesajul care explică de ce generarea e blocată](manual-assets/s2-uniqueness.png)

După generare, sub buton apare bilanțul: **„✓ Toate codurile generate sunt
unice.”** (verde) sau **„⚠ N coduri duplicate …”** (galben), când nu s-au putut
genera destule coduri unice.

#### 5.1.6 Generarea

- **Generează CSV** — produce datele. La loturi mari, butonul arată progresul
  (`Se generează… 1.234 / 250.000`).
- **Descarcă codes.csv** — apare lângă buton după generare; descarcă fișierul.

> Important: dacă schimbi rândurile, codurile sau separatorul **după** generare,
> apare *„Setările s-au modificat. Regenerați CSV-ul pentru a putea continua.”* —
> apasă din nou **„Generează CSV”** ca să poți merge mai departe.

### 5.2 Încarcă CSV

Folosești un fișier CSV gata făcut. Fiecare rând devine un card.

![Modul „Încarcă CSV”: fișierul, rezumatul detectat și opțiunile de corectare](manual-assets/s2-upload.png)

- **Fișier CSV** — încarcă fișierul. **Separatorul** (virgulă, punct și virgulă,
  tab, spațiu etc.) este **detectat automat** — nu trebuie să știi nimic despre
  formatul CSV.
- **Rezumat** (text verde) — confirmă ce a detectat aplicația (ex. *„Separator
  detectat: spațiu · 100 rânduri · 2 coloane”*).
- **Avertismente** (text galben) — apar dacă fișierul are probleme minore (ex.
  rânduri cu număr inegal de coloane, rânduri goale).
- **Fiecare rând este un singur cod** — bifă (apare după încărcare): unește toate
  câmpurile unui rând într-un singur cod. Folosește-o când rândul întreg este un
  singur cod, chiar dacă el conține separatorul.
- **„Separator detectat greșit? Corectează manual”** — secțiune pliabilă; dacă
  detecția a greșit, introduci separatorul corect în câmpul **Separator între
  coduri pe rând**.

**Câmpuri pe rând** — cât timp bifa „un singur cod” e debifată, rândul cu cele
mai multe câmpuri din fișier (cel mai „lat” rând) apare descompus în bucăți —
astfel încât fiecare loc de unire posibil să fie disponibil — cu un buton între
fiecare două bucăți vecine:

![Editorul „Câmpuri pe rând”: bucățile primului rând, cu două bucăți unite](manual-assets/s2-fields.png)

- `|` — bucățile sunt câmpuri (coduri) separate; apasă pentru a le **uni**.
- `∪` — bucățile sunt **unite** într-un singur câmp; apasă pentru a le separa la loc.
- Linia de dedesubt arată rezultatul: *„Rezultă N câmpuri: …”*.

Este util când **un cod conține chiar separatorul**: de ex. codul „1A 1”, cu
separator spațiu, a fost rupt în „1A” și „1” — unești bucățile la loc într-un
singur câmp, fără să re-editezi fișierul.

### 5.3 Previzualizarea datelor

Sub ambele moduri apare o **previzualizare** a primelor rânduri (maximum 15;
numărul total de rânduri este afișat în antet). Reflectă în timp real setările tale.

![Previzualizarea CSV: prefix + interval cu zerouri pentru primul cod și cod aleator pentru al doilea](manual-assets/s2-preview.png)

### 5.4 Deblocarea pașilor următori

Pașii **Coduri** și **PDF** se deblochează abia când datele sunt gata:

- în modul **Generează coduri** — după ce apeși **„Generează CSV”** (iar dacă
  schimbi setările, trebuie să regenerezi);
- în modul **Încarcă CSV** — imediat după o încărcare reușită.

Până atunci, sub pas apare un mesaj galben potrivit modului curent: în **Generează
coduri** — *„Apasă «Generează CSV» în pasul «Date» pentru a continua.”*, iar în
**Încarcă CSV** — *„Încarcă un fișier CSV în pasul «Date» pentru a continua.”*.

---

## 6. Pasul 4 — Coduri

Aici aranjezi vizual codurile pe card. Modificările se văd imediat în
**Previzualizare** (coloana dreaptă).

![Pasul 4 — Coduri: rândul de probă, butoanele de cuvinte, proprietățile cuvântului selectat și codul evidențiat în previzualizare](manual-assets/04-coduri.png)

*Selectează un cuvânt din secțiunea „Setări” pentru a-i regla fontul, alinierea,
culoarea etc. În previzualizare, codul selectat apare cu un chenar punctat
(„marching ants”) și poate fi tras cu mouse-ul.*

### 6.1 Text exemplu

Aici controlezi rândul de probă folosit în previzualizare și trei margini globale.

![Secțiunea „Text exemplu”: rândul de probă și cele trei margini](manual-assets/s3-text-exemplu.png)

- **Rând CSV exemplu** — un rând de probă, folosit **doar pentru previzualizare**
  (nu modifică datele reale). Eticheta îți arată ce **separator** se aplică, iar
  cuvintele rezultate apar ca butoane în secțiunea „Setări” (vezi 6.2).
- **Margine (mm)** — zona de siguranță de la marginea cardului în care **nu** se
  așază text; este și referința pentru alinierile sus/jos/stânga/dreapta.
- **Padding fundal text (mm)** — spațiul lăsat în jurul textului atunci când acesta
  are un **fundal propriu** (vezi „Fundal text” mai jos).
- **Distanțare contur (mm)** — distanța minimă față de tăietură: e folosită atât
  pentru verificare (codurile trebuie să stea cel puțin atât de departe de tăietură
  ca să fie „sigure”), cât și ca margine pentru alinierile **„(contur)”**. Se
  aplică doar când folosești un contur de tăiere.

### 6.2 Cuvinte

Rândul de probă se împarte în **cuvinte** (după separator). Fiecare cuvânt apare ca
un buton în secțiunea „Setări”; apasă pe unul ca să-l **selectezi** (devine
albastru) și să-i editezi proprietățile. Cuvântul selectat este și cel evidențiat
în previzualizare.

![Butoanele de cuvinte: „ABC123” selectat (albastru), „XYZ789” neselectat](manual-assets/s3-word-pills.png)

Pentru cuvântul selectat apare panoul de proprietăți, împărțit în grupuri
pliabile: **Tipografie** și **Poziție** (deschise), **Stil**, **Fundal text** și
**Contur text** (pliate implicit — apasă pe titlu ca să le deschizi). Toate
câmpurile se aplică **doar cuvântului selectat**.

![Panoul de proprietăți al unui cuvânt, cu grupurile Tipografie, Poziție, Stil, Fundal text și Contur text](manual-assets/s3-properties.png)

**Tipografie:**

- **Dimensiune font (pt)** — mărimea textului.
- **Spațiere caractere (pt)** — spațiul suplimentar dintre litere (tracking).
- **Font pentru acest cuvânt** — fiecare cuvânt poate avea propriul font:
  - **Google Font** — cauți după nume și alegi din lista Google Fonts; sugestiile
    sunt afișate chiar cu fontul respectiv. După alegere apare un text de probă în
    fontul ales, câmpul **Stil** (doar stilurile disponibile pentru acel font —
    regular, bold, italic etc.) și butonul **Șterge**, care renunță la font. Dacă
    fontul nu acoperă diacriticele românești, apare avertismentul *„⚠ Acest font
    nu acoperă diacriticele românești (ș, ț, ă, â, î).”*.
  - **Fișier propriu (.ttf/.otf)** — încarci propriul tău fișier de font.

![Alegerea fontului: Google Font cu căutare live, sau fișier propriu](manual-assets/s3-font.png)

**Poziție:**

- **Aliniere orizontală** — `stânga` / `centru` / `dreapta`. Când există un contur
  de tăiere, apar și variantele **`stânga (contur)` / `centru (contur)` /
  `dreapta (contur)`**, care aliniază la caseta conturului (cu „Distanțarea
  contur” din 6.1 ca margine). Ultima opțiune, **`la punct fix`**, îngheață
  poziția curentă în câmpul X.
- **Aliniere verticală** — `sus` / `mijloc` / `jos`, plus variantele `(contur)`
  și `la punct fix`, cu același sens.
- **Y (mm)** — poziția pe verticală (măsurată de la baza cardului). Dacă o
  modifici manual, alinierea verticală trece automat pe **„la punct fix”**.
- **X (mm, gol = automat după aliniere)** — poziția pe orizontală. Lasă câmpul
  **gol** ca să urmeze alinierea orizontală aleasă; completează-l pentru o poziție
  fixă.

> La pozițiile fixe (X completat sau `la punct fix`), fără aliniere la contur,
> apare avertismentul *„Codurile lungi pot ieși în afara fundalului.”* — poziția
> nu se mai adaptează la lungimea codului.

**Stil** (grup pliat implicit):

- **Culoare text** — culoarea literelor, în CMYK (vezi **6.4**). Implicit negru
  (K 100).
- **Opacitate (0-1)** — `0` invizibil … `1` opac.
- **Mod îmbinare text** — modul de blend al textului peste fundal (`normal`,
  `multiply`, `screen` etc.).
- **Rotație (grade)** — rotește cuvântul.
- **Oglindire X** / **Oglindire Y** — întoarce textul pe orizontală / verticală.

**Fundal text** (grup pliat implicit — o casetă colorată în spatele textului):

- Bifează **„fără fundal”** pentru niciun fundal. Debifând-o, apar:
  - **Lățime (mm, gol = automat)** — lățimea casetei; gol = se potrivește
    automat pe text (plus padding-ul din 6.1).
  - **Transparență (0-1)** — `0` invizibil … `1` opac.
  - **Mod îmbinare** — blend-ul casetei peste card.

**Contur text** (grup pliat implicit — o linie pe conturul literelor):

- Bifează **„fără contur”** pentru niciunul. Debifând-o, apar:
  - **Lățime contur (mm)** — grosimea liniei.
  - **Mod îmbinare contur** — blend-ul conturului.

### 6.3 Mutarea codurilor direct în previzualizare

Pe lângă câmpurile de mai sus, poți manevra codurile direct în previzualizarea din
dreapta, cu mouse-ul și tastatura:

![Previzualizare: cuvântul selectat are chenar punctat („marching ants”), fundal galben și contur roșu; al doilea cuvânt e nestilizat](manual-assets/s3-preview-selected.png)

- **Clic** pe un cod îl **selectează** — apare un chenar animat „marching ants”
  (vizibil în jurul lui „ABC123” în imagine).
- **Tragere (drag)** îl **mută** pe card.
- **Shift + tragere** blochează mișcarea pe **o singură axă** (doar orizontal sau
  doar vertical).
- **Săgețile** (← ↑ → ↓) deplasează fin codul selectat, cu pas mic proporțional cu
  dimensiunea cardului (funcționează cât timp previzualizarea are focus — clicul
  de selectare i-l dă automat).

> Imaginea arată și efectul setărilor din 6.2: „ABC123” are font mărit, fundal
> galben și contur roșu, în timp ce „XYZ789” rămâne în stilul implicit.

### 6.4 Selectorul de culoare (CMYK)

Orice câmp de culoare („Culoare text”, „Fundal text”, „Contur text”, „Culoare
fundal”) funcționează la fel:

![Selectorul de culoare CMYK deschis: pătratul de nuanță, cursorul K și butonul Pipetă](manual-assets/04-color-picker.png)

*Selectorul de culoare: apasă pe caseta colorată pentru a-l deschide. Pătratul
alege nuanța/saturația, cursorul **K** reglează negrul, câmpurile **C M Y K** din
rând acceptă valori exacte, iar **Pipeta** preia culoarea din previzualizare.*

- **Caseta colorată** — apasă pe ea pentru a deschide selectorul.
- **Pătratul de culoare** — alegi nuanța și saturația cu clic sau prin tragere.
- **K (cursor)** — reglează nivelul de negru.
- **Câmpurile C, M, Y, K** — introduci valorile exacte în procente.
- **Pipetă** — apasă, apoi **dă clic pe previzualizare** pentru a prelua culoarea
  din fundal exact de sub cursor (apasă **Esc** sau clic în afara previzualizării
  pentru a renunța). Funcționează în orice browser.
- La câmpurile cu opțiunea **„fără …”**, o bifă setează culoarea pe „niciuna”.
  La celelalte câmpuri, lipsa unei culori înseamnă **alb**, iar selectorul rămâne
  vizibil cu valorile pe alb.

---

## 7. Pasul 5 — PDF

Aici produci PDF-urile finale.

![Pasul 5 — PDF: alegerea Print + Contur, aspectul paginii, opțiunile și butoanele de generare](manual-assets/05-pdf.png)

*Ecranul „PDF”: alegi ce se generează (Print / Contur / ambele), reglezi aspectul
paginii și opțiunile. Când bifezi „Măsoară traseele de tăiere” apar parametrii
pentru „Timp de tăiere”.*

Datele nu se mai aleg aici: se folosește CSV-ul pregătit la **Pasul 3 — Date**.

### 7.1 Cere ofertă (doar dacă generarea e protejată)

Unele instanțe blochează generarea în spatele unei **parole**. Doar în acest caz
apar secțiunile **„Cere ofertă”** și deblocarea de mai jos. Dacă nu e configurată
nicio parolă, treci direct la 7.3.

„Cere ofertă” îți permite să trimiți configurația fără să generezi singur PDF-ul:

![Secțiunea „Cere ofertă”: descărcarea setărilor și linkul de email](manual-assets/s4-quote.png)

- **Descarcă setările pentru ofertă (.zip)** — descarcă un fișier cu **toată**
  configurația ta (inclusiv fundalurile și fonturile folosite).
- **trimite-ne un email** — link pregătit (deschide clientul de email cu subiect și
  mesaj completate); atașează fișierul `.zip` descărcat.

### 7.2 Deblocare (dacă este cazul)

![Secțiunea „Setări” blocată: câmpul Parolă și butonul Deblochează](manual-assets/s4-unlock.png)

- **Parolă** — introdu parola primită.
- **Deblochează** — confirmă. Dacă parola e greșită, apare un mesaj roșu; dacă e
  corectă, apar opțiunile de generare (7.3). Deblocarea ține cât durează sesiunea.

### 7.3 Opțiuni de generare

#### 7.3.1 Ce se generează

![„Ce se generează”: Print / Contur / Print + Contur](manual-assets/s4-mode.png)

- **Print** — doar PDF-ul de print (cardurile pe fundal).
- **Contur** — doar PDF-ul cu liniile de tăiere (pe fundalul de contur).
- **Print + Contur** — ambele fișiere.

#### 7.3.2 Aspect pagină

Definește coala pe care se așază (se „impun”) cardurile. Secțiunea dispare când
bifezi **„Non-decupare”** (vezi 7.3.3) — atunci nu mai există impunere.

![„Aspect pagină”: lățime/înălțime pagină, decalaje și diametru cerc](manual-assets/s4-page-layout.png)

- **Lățime pagină (mm)** / **Înălțime pagină (mm)** — dimensiunea colii.
- **Decalaj X (mm)** / **Decalaj Y (mm)** — spațiul dintre tăieturile a două
  carduri vecine, pe orizontală / verticală. Doar un contur dreptunghiular simplu
  poate avea decalaj `0` (cardurile împart aceeași linie de tăiere); pentru
  celelalte forme folosește cel puțin **1,0 mm**, altfel tăierile vecine se
  suprapun și materialul se poate deteriora (apare un avertisment galben).
- **Diametru cerc (mm)** — diametrul **cercurilor de reglaj** pe care cutter-ul le
  folosește pentru aliniere. Ele rezervă o bandă pe marginile colii: zona în care
  se poate tăia este pagina **minus** un diametru pe fiecare margine.

#### 7.3.3 Opțiuni

Unele bife apar doar în anumite moduri — de ex. cele care privesc printul apar
doar la „Print” / „Print + Contur”, iar cele de tăiere doar la „Contur” /
„Print + Contur”.

![„Opțiuni”: bifele de generare](manual-assets/s4-options.png)

- **Non-decupare** — un card pe pagină, fără impunere și fără cercuri de reglaj;
  ascunde „Aspect pagină”.
- **Combină paginile** — suprapune liniile de tăiere peste paginile de print,
  într-un singur fișier (doar cu print, fără „Non-decupare”).
- **Nu printa codurile** — generează PDF-ul de print fără texte (aceeași așezare,
  doar fundalurile).
- **Minimal** — decupează pagina generată la caseta conturului.
- **Contur Dreptunghi** — doar pentru forma presetată **dreptunghi**: emite
  dreptunghiuri simple în loc de liniile de tăiere optimizate (grilă).
- **Corectare depășire** — micșorează automat codurile care depășesc conturul
  (sau cardul) până încap, dar nu sub **Font minim (pt)**; cele care tot nu încap
  rămân semnalate. **Aplică micșorarea** alege dacă se micșorează **Pe cod**
  (doar codul care depășește) sau **Pe coloană** (toată coloana primește aceeași
  dimensiune).
- **Contururi de depanare** — adaugă linii ajutătoare pentru verificare.
- **Măsoară traseele de tăiere** — calculează metricile de tăiere (vezi §9) și
  deschide setările „Timp de tăiere” (7.3.5).

#### 7.3.4 Avertismente

Sub opțiuni pot apărea mesaje galbene care semnalează nepotriviri de dimensiuni:

- **Fundalul nu încape în pagină** — mărește pagina sau micșorează cardul.
- **Conturul nu încape în zona de tăiere** (pagina minus cercurile de reglaj) —
  mărește pagina, micșorează diametrul cercurilor sau conturul.
- **Conturul a fost redus ca să încapă în fundal** — dimensiunea sau rotația
  cerută a fost limitată automat; micșorează conturul sau rotația ca să folosești
  valoarea dorită.
- **Decalaj X/Y prea mic** pentru forma de contur aleasă (vezi 7.3.2).

#### 7.3.5 Timp de tăiere

Apare doar când **„Măsoară traseele de tăiere”** este bifat. Sunt parametrii cu care
se estimează durata de tăiere (vezi metricile din §9).

![„Timp de tăiere”: vitezele, penalizarea de colț și timpul de pregătire](manual-assets/s4-cut-time.png)

- **Viteză de tăiere (mm/s)** — viteza cuțitului în timpul tăierii.
- **Penalizare colț (s)** — timpul adăugat la fiecare colț ascuțit.
- **Timp pregătire (s)** — timp fix de pregătire per job.
- **Viteză deplasare (mm/s)** — viteza la deplasările fără tăiere (între contururi).

### 7.4 Pornirea generării

- **Generează PDF** — pornește generarea propriu-zisă. În timpul lucrului, butonul
  este înlocuit de un **indicator de progres** (faza Print/Contur, rânduri
  procesate, loturi, memorie folosită) și de butonul **Anulează**.
- **Generează o mostră (un card)** — o probă rapidă: un singur card, cu conturul
  suprapus deasupra, fără tot lotul. Ideal ca să verifici așezarea înainte de o
  generare mare.
- Erorile (de ex. lipsa unui fundal de contur când generezi conturul) apar în
  **roșu** sub butoane.

---

## 8. Previzualizarea (coloana dreaptă)

Secțiunea **„Previzualizare”** arată mereu cardul curent, actualizat în timp real
pe măsură ce schimbi setările. Dacă nu ai încă un fundal, apare un mesaj care îți
cere să-l configurezi la Pasul 1.

Deasupra cardului există o bară de unelte:

- **Zoom** — butoanele **− / +** măresc sau micșorează previzualizarea; butonul
  cu procentul (ex. `100%`) o readuce la mărimea normală. Când e mărită, o poți
  **deplasa prin tragere** (pan).
- **📷 Captură** — copiază în clipboard o imagine a previzualizării. Cu bifa
  **„Descarcă”**, imaginea se descarcă ca fișier în loc să fie copiată. Cu bifa
  **„Conturat”** (activă doar când există un contur), captura decupează doar
  interiorul conturului, ca PNG transparent.

---

## 9. Rezultat

După generare, în coloana dreaptă apare secțiunea **„Rezultat”**:

![Secțiunea Rezultat: linkuri de descărcare pentru Print și Contur, plus metricile de tăiere](manual-assets/06-rezultat.png)

*Pentru fiecare PDF apare un link de descărcare și o previzualizare. La „Contur”,
dacă ai activat măsurarea, se afișează metricile de tăiere (carduri pe pagină,
lungime traseu, noduri, colțuri ascuțite, timp de tăiere).*

- Pentru fiecare PDF generat: un **link de descărcare** și o **previzualizare**
  încorporată.
- O **mostră** generată (7.4) apare tot aici, ca **„Mostră (un card)”**, cu
  propriul link de descărcare și propria previzualizare.
- Dacă jobul de print e împărțit în loturi, se descarcă o **arhivă ZIP** (cu
  previzualizarea primului PDF).
- La **Print**, dacă unele coduri ies din zona de tăiere sau de pe card, apare un
  avertisment galben: *„⚠ N rânduri conțin coduri care depășesc zona de tăiere
  sau spațiul cardului (ex: …)”*, împreună cu linkul **„Descarcă depășirile
  (N, .csv)”** — descarcă rândurile afectate ca `depasiri.csv`, ca să le poți
  găsi în datele-sursă.
- Când ai generat ambele fișiere („Print + Contur”), apare și butonul
  **„Descarcă ambele (print + contur, .zip)”** — o singură arhivă cu tot.
- Pentru **Contur**, dacă ai activat măsurarea, se afișează metrici:
  - **Carduri pe pagină**.
  - **Lungime traseu / card** și **totală**.
  - **Noduri / card** și **total**.
  - **Colțuri ascuțite / card** și **total**.
  - **Timp de tăiere / card** și **total**.

---

## 10. Flux de lucru recomandat

1. **Fundal** — alege sau încarcă fundalul de print (PDF, culoare simplă sau
   imagine) și poziționează-l.
2. **Contur** — stabilește forma de tăiere (fișier PDF/SVG sau formă presetată)
   și reglează-i dimensiunea și poziția.
3. **Date** — generează sau încarcă CSV-ul cu coduri; apasă **„Generează CSV”**
   (la generare) ca să deblochezi pașii următori.
4. **Coduri** — așază și stilizează codurile; verifică în previzualizare (trage
   codurile, folosește pipeta pentru culori) și fă o **mostră** la nevoie.
5. **PDF** — alege Print / Contur / ambele, apasă **„Generează PDF”** și descarcă
   rezultatele.

> Sfat: salvează-ți configurația cu **„Salvează setările (.zip)”** ca să poți relua
> oricând munca exact de unde ai rămas.
