# Manual de utilizare — pdfcodes preview

Acest manual explică, pas cu pas, cum se folosește aplicația pentru a aranja
coduri (text) pe un fundal și a genera PDF-uri pregătite pentru **print** și
pentru **tăiere pe contur**.

---

## 1. Ce face aplicația

- Așezi unul sau mai multe **coduri** (text) peste un **fundal** (un card).
- Vezi **în timp real** cum vor arăta cardurile, într-o previzualizare.
- Generezi **datele** (codurile) fie automat, fie dintr-un fișier CSV propriu.
- Obții la final unul sau două PDF-uri:
  - **Print** — cardurile cu fundalul și textul, așezate pe pagină.
  - **Contur** — liniile de tăiere (pentru plotter/cutter).

Toate culorile sunt în **CMYK** (cum se tipărește), iar previzualizarea pe
ecran este o aproximare RGB a culorii de print.

---

## 2. Interfața generală

Ecranul are două coloane:

- **Stânga** — panoul de configurare (se schimbă în funcție de pasul curent).
- **Dreapta** — **Previzualizarea** cardului și, după generare, **Rezultatul**.

Sus găsești:

- Titlul aplicației.
- Butonul **„Mod luminos” / „Mod întunecat”** — comută tema vizuală.

### 2.1 Pașii (asistentul / wizard)

Sub secțiunea „Setări” există o bară cu 4 pași, care trebuie parcurși în ordine:

1. **Fundal**
2. **Sursa de date**
3. **Aspect & Cuvinte**
4. **Generare**

Pașii se **deblochează pe rând**:

- **Fundal** este mereu disponibil.
- **Sursa de date** se deblochează după ce ai configurat fundalul **și** conturul.
- **Aspect & Cuvinte** și **Generare** se deblochează după ce ai pregătit și datele.

Dacă un pas este blocat, apare un mesaj galben care îți spune ce mai ai de făcut.
Jos găsești butoanele de navigare **Înapoi / Înainte**.

### 2.2 Setări (salvare și încărcare)

Secțiunea **„Setări”** (mereu vizibilă, sus):

- **Salvează setările (.zip)** — descarcă un fișier cu **toate** alegerile tale,
  inclusiv fundalurile și fonturile folosite. Util pentru a relua munca mai târziu
  sau pe alt calculator.
- **Încarcă setări (.zip sau .json)** — reîncarcă o configurație salvată anterior.

---

## 3. Pasul 1 — Fundal

Aici stabilești **fundalul de print** și **conturul** (forma de tăiere). Pasul e
considerat complet doar când ai setat **ambele**.

![Pasul 1 — Fundal: fundal simplu și formă presetată (cerc), cu previzualizarea cardului în dreapta](manual-assets/01-fundal.png)

*Ecranul „Fundal”: stânga — configurarea fundalului și a conturului; dreapta —
previzualizarea cardului. Sus se vede bara cu cei 4 pași și secțiunea „Setări”.*

Panoul are, de sus în jos, două grupuri de setări: **Sursă fundal print** (cardul
pe care se tipărește) și **Sursă fundal contur** (linia de tăiere). Mai jos sunt
explicate toate câmpurile, în ordinea în care apar.

### 3.1 Sursă fundal print

Primul comutator alege **de unde vine cardul de print**: dintr-un PDF gata făcut
(**Încarcă PDF**) sau generat de aplicație (**Fundal simplu**). În funcție de
alegere, sub el apar câmpuri diferite.

#### 3.1.1 Încarcă PDF

![Sursă fundal print — Încarcă PDF: butonul de fișier, dimensiunile detectate și câmpurile de redimensionare](manual-assets/f1-print-upload.png)

- **PDF de fundal (un card)** — butonul **„Choose File”** deschide selectorul de
  fișiere. Încarci un PDF care conține **un singur card** (nu o coală întreagă).
- **Dimensiuni detectate** — banda albastră care apare imediat ce PDF-ul e citit.
  Arată dimensiunea reală a paginii în **mm** (și, în paranteză, în **puncte
  tipografice — pt**). E doar informativă, nu o poți edita.
- **Lățime țintă (mm)** / **Înălțime țintă (mm)** — opțional. Pre-completate cu
  dimensiunea detectată; le poți modifica pentru a **redimensiona** cardul (de ex.
  imprimi un card de 15 mm la 20 mm). Codurile deja așezate își păstrează
  **poziția relativă** (proporțională) când schimbi aceste valori, deci nu trebuie
  rearanjate.

#### 3.1.2 Fundal simplu

Generezi cardul direct în aplicație, fără un PDF — util când vrei doar un
dreptunghi colorat sau transparent.

![Sursă fundal print — Fundal simplu: lățime, înălțime și câmpul de culoare, cu cardul colorat în previzualizare](manual-assets/f2-print-simple.png)

- **Lățime (mm)** / **Înălțime (mm)** — dimensiunile cardului generat.
- **Culoare fundal (opțional)** — culoarea de umplere a cardului, în **CMYK**
  (vezi secțiunea **5.4** pentru cum se folosește selectorul). În imagine, cardul
  este galben (C 0 · M 0 · Y 60 · K 25).
  - Bifează **„fără culoare”** (colțul din dreapta-sus al câmpului) pentru un card
    **fără umplere** — adică alb/transparent. Când e bifată, câmpurile de culoare
    dispar.

### 3.2 Sursă fundal contur

Conturul este **linia după care se taie** cardul (pentru plotter/cutter). Al
doilea comutator alege dacă folosești un contur propriu (**Încarcă PDF**) sau o
formă generată automat (**Formă presetată**).

#### 3.2.1 Încarcă PDF

![Sursă fundal contur — Încarcă PDF: câmpul opțional pentru PDF-ul de contur](manual-assets/f5-contour-upload.png)

- **PDF de fundal contur (opțional)** — încarci un PDF care conține **linia de
  tăiere** proprie. E marcat „opțional” pentru că poți folosi în loc o formă
  presetată.

#### 3.2.2 Formă presetată

Aplicația desenează singură conturul, pe baza dimensiunilor cardului de print.

- **Formă** — lista de forme disponibile:

![Cele șase forme presetate: Cerc, Elipsă, Rectangle, colțuri rotunjite, colțuri teșite, Inimă](manual-assets/f6-shapes-gallery.png)

- **Margine interioară (mm)** — cât de mult intră conturul **spre interior** față
  de marginea cardului (de ex. 2 mm). Cu cât e mai mare, cu atât forma de tăiere e
  mai mică decât cardul.
- Câmpuri suplimentare, în funcție de formă:
  - **Rectangle cu colțuri rotunjite** afișează **Raza colțurilor (mm)** (cât de
    rotunde sunt colțurile) și **Orientare** — **În afară** (colțuri rotunjite
    normale) sau **În interior** (colțuri „scobite”/festonate).

    ![Câmpurile pentru colțuri rotunjite: Raza colțurilor și Orientare](manual-assets/f3-rounded-options.png)

  - **Rectangle cu colțuri teșite** afișează **Teșire colțuri (mm)** — lungimea
    teșiturii (colțul tăiat drept, în loc de rotunjit).
- Notă: forma presetată are nevoie întâi de o sursă de print cu dimensiuni
  cunoscute. Dacă alegi „Încarcă PDF” pentru print, **încarcă întâi PDF-ul** —
  altfel apare mesajul *„Încarcă întâi PDF-ul de fundal pentru a genera forma.”*
  (Cu „Fundal simplu”, dimensiunile sunt deja cunoscute.)

### 3.3 Reglaje contur (după ce conturul există)

Indiferent de sursa conturului, odată ce acesta există apar trei câmpuri comune,
care controlează **doar previzualizarea** (nu și fișierul de tăiere):

![Reglaje contur: dimensiunea detectată, transparența și modul de combinare](manual-assets/f4-contour-options.png)

- **Dimensiune contur** — dimensiunile conturului, informativ (în mm).
- **Transparență contur (0–1)** — cât de vizibil este conturul peste fundal în
  previzualizare. `0` = invizibil, `1` = complet opac (implicit `0.5`).
- **Mod combinare contur** — modul de îmbinare (blend) al liniei de contur cu
  fundalul în previzualizare: `normal`, `multiply`, `screen`, `overlay` etc. Util
  ca să vezi conturul clar pe fundaluri închise sau deschise.

---

## 4. Pasul 2 — Sursa de date

Aici stabilești **codurile** care vor apărea pe carduri. **Fiecare rând = un card.**

![Pasul 2 — Sursa de date: modul „Generează coduri”, configurarea unui cod și previzualizarea CSV-ului generat](manual-assets/02-sursa-date.png)

*Modul „Generează coduri”: setezi numărul de rânduri și formatul codului, apeși
„Generează CSV”, apoi vezi o previzualizare a primelor rânduri (și poți descărca
`codes.csv`).*

Primul comutator, **Mod sursă**, alege de unde vin codurile: le **generează**
aplicația sau le **încarci** dintr-un fișier CSV propriu.

![Mod sursă: „Generează coduri” sau „Încarcă CSV”](manual-assets/s2-mode.png)

### 4.1 Generează coduri

Aplicația creează automat fișierul CSV după regulile pe care le definești aici.

#### 4.1.1 Setări generale

![Număr de rânduri și separatorul dintre coduri](manual-assets/s2-generate-top.png)

- **Număr de rânduri** — câte carduri se generează (un rând = un card).
- **Separator între coduri pe rând** — caracterul care desparte mai multe coduri de
  pe **același** rând. Contează doar dacă un card afișează mai multe coduri (vezi
  4.1.4). Implicit este virgula `,`; poți pune un spațiu, `;`, `|` etc.

#### 4.1.2 Blocul „Cod” — structura unui cod

Fiecare cod se construiește după tiparul **prefix + cod + sufix**. Câmpurile sunt:

![Blocul „Cod 1” în modul „Generat aleator”](manual-assets/s2-cod-random.png)

- **Prefix (opțional)** / **Sufix (opțional)** — text fix adăugat **înainte** /
  **după** cod, lipit direct (fără spațiu — dacă vrei un spațiu, include-l tu în
  prefix/sufix).
- **Tip cod** — alege cum se produce partea variabilă a codului:
  - **Generat aleator** — afișează **Caractere** (set de simboluri: `Numeric`,
    `Alfabetic` sau `Alfanumeric (mixt)`) și **Lungime cod** (câte caractere are).
  - **Interval numeric** — afișează **Start interval** și **Pas**: codurile sunt
    numere consecutive (ex. start `1`, pas `1` → 1, 2, 3 …; pas `10` → 1000, 1010 …).

![Același bloc în modul „Interval numeric”: prefix „NR-”, completare cu zerouri](manual-assets/s2-cod-range.png)

#### 4.1.3 Completarea (padding)

Padding-ul aliniază codurile la o lungime fixă (util ca toate să arate la fel, ex.
`00001`, `00002`).

- **Mod completare**:
  - **Până la o lățime** — completează codul cu **Caractere de completare** până la
    **Lățime totală (caractere)**. Ex.: cod `7` + caracter `0` + lățime `5` → `00007`.
  - **Text fix adăugat** — adaugă pur și simplu caracterele de completare în față,
    fără o lățime-țintă.
- **Caractere de completare** — caracterul folosit la completare (de obicei `0`).
- **Lățime totală (caractere)** — apare doar la „Până la o lățime”.

> Notă: dacă lățimea totală este **mai mică sau egală** cu lungimea codului,
> completarea nu are efect și apare un avertisment galben:

![Avertisment: lățimea totală ≤ lungimea codului](manual-assets/s2-padding-warning.png)

#### 4.1.4 Mai multe coduri pe rând

Butonul **„Adaugă cod pe rând”** adaugă încă un bloc „Cod”, deci **fiecare card va
afișa mai multe coduri**, despărțite de separatorul din 4.1.1. Fiecare bloc în plus
are un buton **„Elimină”**.

![Două coduri pe rând: „Cod 1” (interval) și „Cod 2” (aleator), fiecare cu „Elimină”](manual-assets/s2-multi-code.png)

#### 4.1.5 Generarea

- **Generează CSV** — produce datele. La loturi mari, butonul arată progresul
  (`Se generează… 1.234 / 250`).
- **Descarcă codes.csv** — apare lângă buton după generare; descarcă fișierul.

> Important: dacă schimbi rândurile, codurile sau separatorul **după** generare,
> apare *„Setările s-au modificat. Regenerați CSV-ul…”* — apasă din nou
> **„Generează CSV”** ca să poți continua la pașii următori.

### 4.2 Încarcă CSV

Folosești un fișier CSV gata făcut. Fiecare rând devine un card.

![Modul „Încarcă CSV”: fișierul, rezumatul detectat și corectarea manuală a separatorului](manual-assets/s2-upload.png)

- **Fișier CSV** — butonul **„Choose File”** încarcă fișierul. **Separatorul**
  (virgulă, punct și virgulă, tab, spațiu etc.) este **detectat automat**.
- **Rezumat** (text verde) — confirmă ce a detectat aplicația: separatorul,
  numărul de rânduri și de coloane (ex. *„Separator detectat: spațiu · 100 rânduri ·
  2 coloane”*).
- **Avertismente** (text galben) — apar dacă fișierul are probleme minore (ex.
  rânduri cu număr inegal de coloane, rânduri goale).
- **„Separator detectat greșit? Corectează manual”** — secțiune pliabilă; dacă
  detecția a greșit, o deschizi și introduci manual separatorul corect în câmpul
  **Separator între coduri pe rând**.

### 4.3 Previzualizarea datelor

Sub ambele moduri apare o **previzualizare** a primelor rânduri (maximum 15), cu
numărul total de rânduri afișat în antet. Reflectă în timp real setările tale.

![Previzualizarea CSV: prefix + interval cu zerouri pentru primul cod și cod aleator pentru al doilea](manual-assets/s2-preview.png)

---

## 5. Pasul 3 — Aspect & Cuvinte

Aici aranjezi vizual codurile pe card. Modificările se văd imediat în
**Previzualizare** (coloana dreaptă).

![Pasul 3 — Aspect & Cuvinte: butoanele de cuvinte, proprietățile cuvântului selectat și codul evidențiat în previzualizare](manual-assets/03-aspect-cuvinte.png)

*Selectează un cuvânt din zona „Cuvinte” pentru a-i regla fontul, alinierea,
culoarea etc. În previzualizare, codul selectat apare cu un chenar punctat
(„marching ants”) și poate fi tras cu mouse-ul.*

### 5.1 Text exemplu

Aici controlezi rândul de probă folosit în previzualizare și două margini globale.

![Secțiunea „Text exemplu”: rândul de probă, marginea de siguranță și padding-ul fundalului de text](manual-assets/s3-text-exemplu.png)

- **Rând CSV exemplu** — un rând de probă, folosit **doar pentru previzualizare**
  (nu modifică datele reale). Eticheta îți arată ce **separator** se aplică (în
  imagine: „spațiu”), iar cuvintele rezultate apar ca butoane în „Cuvinte”.
- **Margine de siguranță (mm)** — zona de la marginea cardului în care **nu** se
  așază text; este și referința pentru alinierile sus/jos/stânga/dreapta.
- **Padding fundal text (mm)** — spațiul lăsat în jurul textului atunci când acesta
  are un **fundal propriu** (vezi „Fundal text” mai jos).

### 5.2 Cuvinte

Rândul de probă se împarte în **cuvinte** (după separator). Fiecare cuvânt apare ca
un buton; apasă pe unul ca să-l **selectezi** (devine albastru) și să-i editezi
proprietățile. Cuvântul selectat este și cel evidențiat în previzualizare.

![Butoanele de cuvinte: „ABC123” selectat (albastru), „XYZ789” neselectat](manual-assets/s3-word-pills.png)

Pentru cuvântul selectat apare panoul de proprietăți de mai jos. Toate câmpurile se
aplică **doar cuvântului selectat** (excepție: fontul — vezi nota de la final).

![Panoul complet de proprietăți al unui cuvânt, cu fundal și contur activate](manual-assets/s3-properties.png)

**Tipografie și poziție:**

- **Dimensiune font (pt)** — mărimea textului.
- **Spațiere caractere (pt)** — spațiul suplimentar dintre litere (tracking).
- **Aliniere orizontală** — `stânga` / `centru` / `dreapta`. Schimbarea ei
  **resetează X la „automat”** (golul din câmpul X).
- **Aliniere verticală** — `sus` / `mijloc` / `jos` / `personalizat`.
- **Y (mm)** — poziția pe verticală (măsurată de la baza cardului). Dacă o
  modifici manual, alinierea verticală trece automat pe **„personalizat”** (vezi
  imaginea: Y = 25 → „personalizat”).
- **X (mm, gol = automat după aliniere)** — poziția pe orizontală. Lasă câmpul
  **gol** ca să urmeze alinierea orizontală aleasă; completează-l pentru o poziție
  fixă.

**Culoare și aspect:**

- **Culoare text** — culoarea literelor, în CMYK (vezi **5.4**). Implicit negru
  (K 100).
- **Mod îmbinare text** — modul de blend al textului peste fundal (`normal`,
  `multiply`, `screen` etc.).
- **Rotație (grade)** — rotește cuvântul.
- **Oglindire X** / **Oglindire Y** — întoarce textul pe orizontală / verticală.

**Fundal text** (o casetă colorată în spatele textului):

- Bifează **„fără fundal”** pentru niciun fundal. Debifând-o, apar:
  - **Lățime fundal (mm, gol = automat)** — lățimea casetei; gol = se potrivește
    automat pe text (plus padding-ul din 5.1).
  - **Transparență fundal (0–1)** — `0` invizibil … `1` opac.
  - **Mod îmbinare fundal** — blend-ul casetei peste card.

**Contur text** (un contur pe conturul literelor):

- Bifează **„fără contur”** pentru niciunul. Debifând-o, apar:
  - **Lățime contur (mm)** — grosimea liniei.
  - **Mod îmbinare contur** — blend-ul conturului.

**Font pentru acest cuvânt:**

![Alegerea fontului: Google Font cu căutare live, sau fișier propriu](manual-assets/s3-font.png)

- **Google Font** — cauți după nume și alegi din lista Google Fonts; sugestiile
  sunt afișate chiar cu fontul respectiv.
- **Fișier propriu (.ttf/.otf)** — încarci propriul tău fișier de font.
- Notă: dacă un singur cuvânt are font setat, acel font se aplică **tuturor**
  cuvintelor.

### 5.3 Mutarea codurilor direct în previzualizare

Pe lângă câmpurile de mai sus, poți manevra codurile direct în previzualizarea din
dreapta, cu mouse-ul și tastatura:

![Previzualizare: cuvântul selectat are chenar punctat („marching ants”), fundal galben și contur roșu; al doilea cuvânt e nestilizat](manual-assets/s3-preview-selected.png)

- **Clic** pe un cod îl **selectează** — apare un chenar animat „marching ants”
  (vizibil în jurul lui „ABC123” în imagine).
- **Tragere (drag)** îl **mută** pe card.
- **Shift + tragere** blochează mișcarea pe **o singură axă** (doar orizontal sau
  doar vertical).
- **Săgețile** (← ↑ → ↓) deplasează fin codul selectat, cu pas mic proporțional cu
  dimensiunea cardului.

> Imaginea arată și efectul setărilor din 5.2: „ABC123” are font mărit, fundal
> galben și contur roșu, în timp ce „XYZ789” rămâne în stilul implicit.

### 5.4 Selectorul de culoare (CMYK)

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

## 6. Pasul 4 — Generare

Aici produci PDF-urile finale.

![Pasul 4 — Generare: alegerea Print + Contur, aspectul paginii, opțiuni și parametrii de timp de tăiere](manual-assets/05-generare.png)

*Ecranul „Generare”: alegi ce se generează (Print / Contur / ambele), reglezi
aspectul paginii și opțiunile. Când bifezi „Măsoară traseele de tăiere” apar
parametrii pentru „Timp de tăiere”.*

### 6.1 Cere ofertă (doar dacă generarea e protejată)

Unele instanțe blochează generarea în spatele unei **parole**. Doar în acest caz
apar secțiunile **„Cere ofertă”** și deblocarea de mai jos. Dacă nu e configurată
nicio parolă, treci direct la 6.3.

„Cere ofertă” îți permite să trimiți configurația fără să generezi singur PDF-ul:

![Secțiunea „Cere ofertă”: descărcarea setărilor și linkul de email](manual-assets/s4-quote.png)

- **Descarcă setările pentru ofertă (.zip)** — descarcă un fișier cu **toată**
  configurația ta (inclusiv fundalurile și fonturile folosite).
- **trimite-ne un email** — link pregătit (deschide clientul de email cu subiect și
  mesaj completate); atașează fișierul `.zip` descărcat.

### 6.2 Deblocare (dacă este cazul)

![Secțiunea „Generare” blocată: câmpul Parolă și butonul Deblochează](manual-assets/s4-unlock.png)

- **Parolă** — introdu parola primită.
- **Deblochează** — confirmă. Dacă parola e greșită, apare un mesaj roșu; dacă e
  corectă, apar opțiunile de generare (6.3). Deblocarea ține cât durează sesiunea.

### 6.3 Opțiuni de generare

#### 6.3.1 Ce se generează și datele

![„Ce se generează” (Print / Contur / Print + Contur) și fișierul CSV cu date](manual-assets/s4-mode-csv.png)

- **Ce se generează**:
  - **Print** — doar PDF-ul de print (cardurile pe fundal).
  - **Contur** — doar PDF-ul cu liniile de tăiere (pe fundalul de contur).
  - **Print + Contur** — ambele fișiere.
- **Fișier CSV cu date (necesar pentru generare)** — fișierul cu coduri folosit la
  generare. Dacă ai generat sau încărcat datele la **Pasul 2**, este deja pregătit
  (chiar dacă aici scrie „No file chosen”); poți încărca aici alt fișier ca să-l
  înlocuiești.

#### 6.3.2 Aspect pagină

Definește coala pe care se așază cardurile.

![„Aspect pagină”: lățime/înălțime pagină, decalaje și diametru cerc](manual-assets/s4-page-layout.png)

- **Lățime pagină (mm)** / **Înălțime pagină (mm)** — dimensiunea colii.
- **Decalaj X (mm)** / **Decalaj Y (mm)** — deplasează tot conținutul pe pagină.
- **Diametru cerc (mm)** — folosit la așezarea cardurilor pe un cerc.

#### 6.3.3 Opțiuni

![„Opțiuni”: Combină paginile, Contururi de depanare, Măsoară traseele de tăiere](manual-assets/s4-options.png)

- **Combină paginile** — pune rezultatele într-un singur fișier.
- **Contururi de depanare** — adaugă linii ajutătoare pentru verificare.
- **Măsoară traseele de tăiere** — calculează metricile de tăiere (vezi 8).
  Apare **doar** când generezi conturul (mod „Contur” sau „Print + Contur”).

#### 6.3.4 Timp de tăiere

Apare doar când **„Măsoară traseele de tăiere”** este bifat. Sunt parametrii cu care
se estimează durata de tăiere (vezi metricile din 8).

![„Timp de tăiere”: vitezele, penalizarea de colț și timpul de pregătire](manual-assets/s4-cut-time.png)

- **Viteză de tăiere (mm/s)** — viteza cuțitului în timpul tăierii.
- **Penalizare colț (s)** — timpul adăugat la fiecare colț ascuțit.
- **Timp pregătire (s)** — timp fix de pregătire per job.
- **Viteză deplasare (mm/s)** — viteza la deplasările fără tăiere (între contururi).

### 6.4 Pornirea generării

- **Generează PDF** — pornește generarea. La loturi mari, butonul este înlocuit de
  un **indicator de progres** (faza Print/Contur, rânduri procesate, loturi, memorie
  folosită) și de butonul **Anulează**.
- Erorile (de ex. lipsa unui fundal de contur când generezi conturul) apar în
  **roșu** sub buton.

---

## 7. Previzualizarea (coloana dreaptă)

- Secțiunea **„Previzualizare”** arată mereu cardul curent, actualizat în timp real
  pe măsură ce schimbi setările. Dacă nu ai încă un fundal, apare un mesaj care îți
  cere să încarci un PDF de fundal.

---

## 8. Rezultat

După generare, în coloana dreaptă apare secțiunea **„Rezultat”**:

![Secțiunea Rezultat: linkuri de descărcare pentru Print și Contur, plus metricile de tăiere](manual-assets/06-rezultat.png)

*Pentru fiecare PDF apare un link de descărcare și o previzualizare. La „Contur”,
dacă ai activat măsurarea, se afișează metricile de tăiere (carduri pe pagină,
lungime traseu, noduri, colțuri ascuțite, timp de tăiere).*

- Pentru fiecare PDF generat: un **link de descărcare** și o **previzualizare**
  încorporată.
- Dacă jobul de print e împărțit în loturi, se descarcă o **arhivă ZIP** (cu
  previzualizarea primului PDF).
- Pentru **Contur**, dacă ai activat măsurarea, se afișează metrici:
  - **Carduri pe pagină**.
  - **Lungime traseu / card** și **totală**.
  - **Noduri / card** și **total**.
  - **Colțuri ascuțite / card** și **total**.
  - **Timp de tăiere / card** și **total**.

---

## 9. Flux de lucru recomandat

1. **Fundal** — alege/încarcă fundalul de print și conturul.
2. **Sursa de date** — generează sau încarcă CSV-ul cu coduri și apasă
   **„Generează CSV”**.
3. **Aspect & Cuvinte** — așază și stilizează codurile; verifică în previzualizare
   (trage codurile, folosește pipeta pentru culori).
4. **Generare** — alege Print / Contur / ambele și apasă **„Generează PDF”**.
5. Descarcă rezultatele.

> Sfat: salvează-ți configurația cu **„Salvează setările (.zip)”** ca să poți relua
> oricând munca exact de unde ai rămas.
