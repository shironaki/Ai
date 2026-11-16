/**
 * Словарь художника: что рисовать по частым просьбам — готовыми описаниями.
 *
 * Зачем. Художник понимает английский и рисует то, что описано. Просьба в одно
 * слово («кота», «Мекку») после перевода — одно слово, а на одно слово его
 * фильтр срабатывает зря (известная беда мастерской), и картинка выходит какой
 * попало. Здесь частые просьбы описаны заранее: кто, где, какой свет. На такую
 * просьбу не тратится ни переводчик, ни модель.
 *
 * Строка: «формы слова через | => описание по-английски». Формы — как их
 * говорят после «нарисуй»: «кот», «кота», «котика». Буква «ё» пишется как «е».
 * Раздел «# места» — названия, которые узнаются и внутри длинной просьбы
 * («Мекку на закате»): их описание идёт художнику подсказкой.
 *
 * Правила описаний: сначала — кто или что, потом — где и какой свет; ничего,
 * что читается как отрицание («no», «without»): художник отрицаний не понимает.
 * У живых — «both eyes open»: иначе он любит подмигивать.
 */
const TABLE = `
# звери
кот|кота|котик|котика|кошка|кошку|кошечка|кошечку|котейка|котейку => a photo of a fluffy domestic cat sitting upright on a wooden floor, both eyes open and looking at the camera, whiskers, soft daylight from a window, sharp focus, detailed fur
котёнок|котенка|котята|котят => a photo of a small fluffy kitten sitting on a soft blanket, both eyes open, curious look at the camera, warm soft light, detailed fur
собака|собаку|пес|пса|песик|песика|собачка|собачку => a photo of a friendly dog sitting on green grass in a park, both eyes open, looking at the camera, sunny day, sharp focus, detailed fur
щенок|щенка|щенки|щенят => a photo of a cute puppy sitting on green grass, both eyes open, looking at the camera, soft sunlight, detailed fur
лиса|лису|лисица|лисицу|лисичка|лисичку|лис => a photo of a red fox standing in a snowy forest, both eyes open, looking at the camera, soft winter light, detailed fur
волк|волка => a photo of a grey wolf standing on a rock in a misty forest, both eyes open, calm strong look, soft morning light, detailed fur
медведь|медведя|мишка|мишку => a photo of a brown bear standing in a green forest meadow near a river, both eyes open, soft daylight, detailed fur
заяц|зайца|зайчик|зайчика|кролик|кролика => a photo of a fluffy rabbit sitting in green grass with small flowers, both eyes open, long ears up, soft daylight
белка|белку|белочка|белочку => a photo of a red squirrel sitting on a tree branch and holding a nut, fluffy tail, both eyes open, autumn forest, soft light
ёж|ежа|ежик|ежика => a photo of a small hedgehog walking on autumn leaves in a forest, cute face, both eyes open, soft light, blurred background
лошадь|лошадку|конь|коня|скакун|скакуна => a photo of a beautiful horse galloping across a green field, mane flowing in the wind, mountains in the distance, golden evening light
тигр|тигра => a photo of a Bengal tiger walking through a green jungle, orange fur with black stripes, both eyes open, looking at the camera, soft light
лев|льва => a photo of a male lion with a full mane lying on a rock in the savanna, both eyes open, calm proud look, golden sunset light
слон|слона => a photo of an African elephant walking across the savanna at sunset, large ears and tusks, acacia trees, warm golden light
жираф|жирафа => a photo of a giraffe standing among acacia trees in the savanna, long neck, both eyes open, blue sky, warm daylight
панда|панду => a photo of a giant panda sitting among green bamboo and eating a bamboo stalk, black and white fur, both eyes open, soft daylight
обезьяна|обезьяну|обезьянка|обезьянку => a photo of a small monkey sitting on a tree branch in a green jungle, both eyes open, curious look, soft daylight
олень|оленя => a photo of a deer with large antlers standing in a misty autumn forest at dawn, both eyes open, soft golden light
верблюд|верблюда => a photo of a camel walking across golden sand dunes in the desert at sunset, long shadows, warm light
сова|сову|совенок|совенка => a photo of an owl sitting on a tree branch in a forest at dusk, big round yellow eyes both open, detailed feathers, soft light
орёл|орла => a photo of an eagle soaring over snowy mountain peaks, wings spread wide, clear blue sky, sharp detail
сокол|сокола => a photo of a falcon perched on a leather glove in the desert, sharp eyes both open, detailed feathers, warm evening light
птица|птицу|птичка|птичку => a photo of a small colorful songbird sitting on a blossoming branch, detailed feathers, soft spring light, blurred green background
попугай|попугая => a photo of a bright macaw parrot with red, blue and yellow feathers sitting on a branch in a tropical forest, both eyes open, soft daylight
пингвин|пингвина => a photo of an emperor penguin standing on Antarctic ice, snow and blue sky behind, black and white feathers, soft daylight
лебедь|лебедя => a photo of a white swan gliding on a calm lake, curved neck, reflection in the water, soft morning mist
утка|утку|уточка|уточку => a photo of a duck swimming on a calm pond among water lilies, reflections in the water, soft daylight
петух|петуха => a photo of a rooster with a red comb and colorful tail feathers standing on a wooden fence in a village yard, morning light
дельфин|дельфина => a photo of a dolphin jumping out of blue ocean water, splashes sparkling in sunlight, clear sky
кит|кита => a photo of a humpback whale breaching out of the ocean, huge splash, sunlight on the water
акула|акулу => an underwater photo of a shark swimming in clear blue water above the sandy bottom, sun rays from the surface
рыба|рыбу|рыбка|рыбку|рыбки|рыбок => an underwater photo of colorful tropical fish swimming over a coral reef in clear turquoise water, sun rays from above
черепаха|черепаху => an underwater photo of a sea turtle swimming in clear turquoise water above a coral reef, sun rays from above
бабочка|бабочку => a macro photo of a butterfly with bright blue and orange wings sitting on a pink flower, soft green background, sunlight
пчела|пчелу => a macro photo of a honey bee collecting pollen on a yellow flower, detailed wings, soft sunlight, blurred green background
божья коровка|божью коровку => a macro photo of a red ladybug with black spots on a green leaf with dew drops, soft morning light
лягушка|лягушку => a photo of a small green frog sitting on a water lily leaf in a pond, both eyes open, soft daylight
змея|змею => a photo of a green snake coiled on a tree branch in a rainforest, detailed scales, soft daylight
корова|корову => a photo of a spotted cow standing in a green meadow with wild flowers, both eyes open, blue sky, sunny day
овца|овцу|овечка|овечку|барашек|барашка|баран|барана => a photo of a fluffy white sheep standing in a green mountain pasture, both eyes open, blue sky, sunny day
коза|козу|козленок|козленка => a photo of a small white goat standing on a rock in a green mountain meadow, both eyes open, sunny day
хомяк|хомяка|хомячок|хомячка => a photo of a cute golden hamster holding a sunflower seed in its paws, both eyes open, soft light, blurred background
мышь|мышку|мышонок|мышонка => a photo of a tiny field mouse sitting on a wheat ear, round ears, both eyes open, soft golden light
дракон|дракона => a majestic dragon with emerald scales and wide wings flying over misty mountains at sunrise, fantasy digital painting, highly detailed
единорог|единорога => a white unicorn with a spiral horn and a flowing mane standing in a sunlit magical forest glade, fantasy digital painting, soft glowing light
динозавр|динозавра => a Tyrannosaurus rex walking through a prehistoric jungle with ferns and mist, realistic digital painting, dramatic light
феникс|феникса|жар-птица|жар-птицу => a phoenix bird with wings of bright fire rising into a dark sky, glowing feathers, sparks, fantasy digital painting

# природа
море|океан => a wide photo of a calm blue sea with gentle waves rolling onto a sandy beach, clear sky with light clouds, bright daylight
закат|закат на море|закат над морем|морской закат|закат солнца => a wide landscape photo of a sunset over the sea, the orange sun touching the horizon, glowing clouds, golden reflections on calm water
рассвет|восход|восход солнца => a wide landscape photo of a sunrise over misty hills, the sun rising above the horizon, soft pink and golden sky, dew on the grass
горы|гора|гору => a wide landscape photo of snow-capped mountain peaks above a green alpine valley with a clear lake, blue sky, morning light
лес => a landscape photo of a sunlit green forest with tall trees, rays of light through the leaves, a narrow path, ferns and moss
осень|осенний лес|осенний парк => a photo of an autumn park alley with golden and red maple trees, fallen leaves on the path, a wooden bench, soft warm light
зима|зимний лес|зимний пейзаж => a landscape photo of a winter forest covered with fresh snow, frosty fir trees, soft sunlight, blue shadows on the snow
весна|весну => a photo of a spring landscape with blossoming cherry trees, green grass, small flowers, bright blue sky, soft sunlight
лето => a landscape photo of a summer meadow with wild flowers and green grass under a bright blue sky with white clouds, warm sunlight
дождь => a cinematic photo of rain falling on a city street in the evening, wet pavement reflecting warm street lamps, umbrellas in the distance
радуга|радугу => a wide landscape photo of a bright rainbow arching over green hills after rain, dramatic clouds parting, sunlight
звёзды|звездное небо|ночное небо => a long exposure photo of a night sky full of stars with the Milky Way above dark mountain silhouettes and a calm lake reflecting the stars
космос|галактика|галактику|вселенная|вселенную => deep space with a spiral galaxy, colorful nebula clouds and countless stars, highly detailed space art
луна|луну|полная луна|полную луну => a photo of a large full moon rising over a calm sea at night, a moonlight path on the water, stars, a few thin clouds
солнце|солнышко => a photo of the bright sun shining in a clear blue sky over a field of golden wheat, sun rays, warm summer light
земля|землю|планета земля|планету земля => planet Earth seen from space, blue oceans, white clouds, continents, a thin glowing atmosphere, black starry background, realistic
река|реку|речка|речку => a landscape photo of a quiet river winding through a green valley with trees on the banks, reflections in the water, soft morning light
озеро => a landscape photo of a calm mountain lake with clear water reflecting pine forest and peaks, a wooden pier, morning mist
водопад => a landscape photo of a tall waterfall falling from a green cliff into a turquoise pool, mist and a small rainbow, tropical plants
пустыня|пустыню => a landscape photo of golden sand dunes in a vast desert at sunset, wind patterns on the sand, long shadows, clear sky
остров|тропический остров => an aerial photo of a small tropical island with palm trees and white sand in turquoise ocean water, bright sunlight
пляж => a photo of a tropical beach with white sand, palm trees leaning over turquoise water, gentle waves, blue sky, bright daylight
поле => a landscape photo of a wide green field with wild flowers under a big blue sky with white clouds, a lone tree, warm sunlight
цветы|цветок|букет|букет цветов => a photo of a lush bouquet of fresh roses, peonies and tulips in a glass vase on a wooden table by a window, soft daylight
роза|розу|розы => a macro photo of a single red rose with water drops on the petals, dark blurred background, soft light
тюльпан|тюльпаны => a photo of a field of colorful tulips in long rows stretching to the horizon, a windmill in the distance, blue sky, sunny spring day
ромашка|ромашку|ромашки => a photo of white daisies with yellow centres in a green summer meadow, blue sky, soft sunlight
подсолнух|подсолнухи => a photo of a field of bright yellow sunflowers facing the sun under a blue sky, warm summer light
дерево => a photo of a large old oak tree standing alone on a green hill, wide crown, blue sky with clouds, soft evening light
сакура|сакуру => a photo of blossoming sakura cherry trees along a river in Japan, pink petals falling, soft spring light
пальма|пальму|пальмы => a photo of tall palm trees on a sandy beach against a bright blue sky, turquoise sea behind, sunny day
северное сияние => a long exposure photo of green and purple northern lights over a snowy landscape with pine trees and a frozen lake, starry sky
снег|снегопад => a photo of large snowflakes falling on a quiet street with warm street lamps and snow-covered trees, evening, soft light
гроза|молния|молнию => a dramatic photo of a thunderstorm at night, bright lightning bolts striking from dark clouds over a field
облака|небо => a photo of fluffy white cumulus clouds in a bright blue sky, sun rays breaking through, seen from a green meadow
вулкан => a dramatic photo of an erupting volcano at night, glowing lava flowing down the slope, ash cloud lit from below
туман => a photo of a misty morning forest, tree silhouettes fading into soft fog, rays of sunlight, calm mood
пещера|пещеру => a photo of a large cave with stalactites and a clear underground lake, a beam of sunlight from an opening above
ночной город|ночь|ночной мегаполис => a cinematic photo of a modern city skyline at night, lit skyscrapers reflected in a river, light trails from cars on a bridge
город => a photo of a cozy old European town street with colorful houses, cobblestones, cafe tables and flowers, soft evening light
деревня|деревню => a photo of a quiet village with wooden houses, gardens and a dirt road among green hills, morning mist, soft sunlight
сад => a photo of a blooming garden with rose bushes, a stone path, a small fountain and a wooden bench, soft morning light
оазис => a photo of a desert oasis with date palms around a clear blue pond among golden sand dunes, bright daylight

# вещи и сцены
дом|домик => a photo of a cozy wooden house with a porch and warm light in the windows, a garden with flowers, pine trees around, evening
замок => a photo of a medieval stone castle with towers on a green hill above a river, flags on the towers, dramatic clouds, sunset light
машина|машину|автомобиль|тачка|тачку => a photo of a sleek red sports car driving on a coastal road by the sea, motion blur on the wheels, sunset light
мотоцикл => a photo of a classic motorcycle parked on an empty mountain road at sunset, chrome details, warm light
корабль|парусник => a photo of a tall sailing ship with white sails on the open sea, waves, dramatic sunset sky
лодка|лодку => a photo of a small wooden boat on a calm lake at dawn, light mist, reflections in the water, soft pastel sky
самолёт => a photo of a passenger airplane flying above white clouds at sunset, golden light on the wings
ракета|ракету => a dramatic photo of a space rocket lifting off from a launch pad with bright flames and clouds of smoke, blue sky
поезд => a photo of a red train crossing a stone viaduct among green mountains, steam of morning mist in the valley, sunlight
велосипед => a photo of a vintage bicycle with a basket of flowers leaning against an old brick wall, soft morning light
робот|робота => a friendly humanoid robot with a round head and glowing blue eyes standing in a bright modern laboratory, detailed 3D render
чай|чашка чая|чашку чая => a photo of a glass cup of hot tea with steam on a wooden table, a teapot, lemon slices and honey, warm cozy light
кофе|чашка кофе|чашку кофе => a photo of a cup of cappuccino with latte art on a wooden cafe table, coffee beans, morning light from a window
торт|тортик => a photo of a festive cake with white cream, fresh berries and lit candles on a table, soft warm light
пицца|пиццу => a photo of a freshly baked pizza with melted cheese, tomatoes and basil on a wooden board, rustic table, warm light
плов => a photo of a large dish of Uzbek pilaf: golden rice with pieces of lamb, carrots, chickpeas and a whole head of garlic on top, patterned ceramic plate
финики|финик => a photo of a bowl of ripe dates on an ornate tray next to a small cup of Arabic coffee and a brass coffee pot, warm light
фрукты => a photo of a bowl of fresh fruits: apples, oranges, grapes, peaches and pomegranate on a wooden table, soft daylight
яблоко => a photo of a ripe red apple with water drops on a wooden table, green leaves, soft daylight
арбуз => a photo of a ripe watermelon cut into slices on a wooden table outdoors, bright red flesh, summer sunlight
мороженое => a photo of three scoops of ice cream in a waffle cone, vanilla, strawberry and chocolate, bright summer background
книга|книгу|книги => a photo of an open old book on a wooden desk with a candle, a cup of tea and a pair of glasses, warm cozy light
библиотека|библиотеку => a photo of a grand old library with tall wooden bookshelves, ladders, reading lamps and sunlight from high windows
гитара|гитару => a photo of an acoustic guitar leaning against a chair on a wooden porch, warm sunset light
пианино|рояль => a photo of a black grand piano in a bright room with large windows and light curtains, soft daylight
маяк => a photo of a white lighthouse on a rocky cliff above the sea, waves crashing, a beam of light in the dusk, dramatic sky
мост => a photo of a long suspension bridge over a bay in morning fog, towers rising above the mist, soft golden light
фонтан => a photo of an ornate stone fountain in a city square, sparkling water jets, flowers around, sunny day
сердце|сердечко => a glossy red heart on a soft pink background with small sparkles, 3D render, soft light
звезда|звезду => a single bright golden star shining in a deep blue night sky above dark hills, soft glow, digital painting
огонь|костер => a photo of a campfire burning at night in a forest clearing, sparks flying up, logs to sit on, starry sky
свеча|свечу|свечи => a photo of a burning candle on a wooden table in a dark room, warm glow, soft shadows
часы => a photo of a vintage pocket watch with an open cover lying on an old map, warm light, fine detail
меч => a medieval sword with an ornate hilt stuck into a stone in a misty forest, a beam of light, fantasy digital painting
корона|корону => a photo of a golden royal crown with red and blue gems on a dark velvet cushion, soft spotlight
ёлка|елку|новогодняя елка|новогоднюю елку => a photo of a decorated New Year fir tree with garlands, golden balls and a star on top, gifts underneath, a cozy room with warm lights, snow outside the window
снеговик|снеговика => a cheerful snowman with a carrot nose, a red scarf and a bucket hat in a snowy yard, falling snow, soft winter light, illustration
подарок|подарки => a photo of gift boxes wrapped in bright paper with ribbons and bows on a wooden table, small lights, warm festive mood
шарики|воздушные шары|воздушный шар => a photo of colorful hot air balloons floating over green hills at sunrise, soft golden light
салют|фейерверк => a photo of colorful fireworks exploding in the night sky over a city river, reflections on the water
комната|комнату => a photo of a cozy room with a soft armchair, a floor lamp, bookshelves, plants and a big window with evening city lights
кухня|кухню => a photo of a bright cozy kitchen with wooden shelves, herbs in pots, a kettle on the stove and morning light from a window
корабль в космосе|космический корабль => a large spaceship flying past a ringed planet, stars and a distant nebula, detailed science fiction art

# герои
рыцарь|рыцаря => a medieval knight in shining plate armor holding a sword, standing on a hill with a castle behind, dramatic sky, fantasy digital painting
самурай|самурая => a samurai in traditional armor with a katana standing under blossoming cherry trees in the mist, digital painting
ниндзя => a ninja in dark clothes crouching on a tiled roof under a full moon, an old Japanese town below, digital painting
пират|пирата => a pirate captain in a tricorn hat and a long coat standing at the wheel of a sailing ship, stormy sea, digital painting
космонавт|космонавта|астронавт|астронавта => an astronaut in a white space suit floating in space above the Earth, stars, sunlight reflecting on the helmet visor, realistic
волшебник|волшебника|маг|мага => an old wizard with a long white beard, a pointed hat and a wooden staff with a glowing crystal, standing in a tower library, fantasy digital painting
эльф|эльфа => an elf archer with long hair and pointed ears in a green cloak standing in an ancient sunlit forest, fantasy digital painting
гном|гнома => a dwarf with a braided beard and a heavy hammer standing at the entrance of a mountain forge, warm fire light, fantasy digital painting
инопланетянин|инопланетянина|пришелец|пришельца => a friendly little green alien with big dark eyes standing next to a silver flying saucer on a hill at night, starry sky, digital painting
привидение|призрак|призрака => a cute friendly cartoon ghost floating in a moonlit old attic, soft glow, illustration
дед мороз|деда мороза => Ded Moroz, the Russian Father Frost: an old man with a long white beard in a long blue fur-trimmed coat and hat, holding a staff, snowy forest, illustration
девушка|девушку => a portrait photo of a young adult woman with long hair in a light sweater, gentle smile, both eyes open, standing in an autumn park, soft natural light
парень|парня|мужчина|мужчину => a portrait photo of a young adult man in a dark coat, calm friendly look, both eyes open, standing on a city street in the evening, soft light
бабушка|бабушку => a portrait photo of a kind elderly woman in a knitted shawl smiling warmly, sitting by a window with a cup of tea, soft daylight
дедушка|дедушку => a portrait photo of a kind elderly man with a grey beard smiling warmly, sitting on a wooden bench in a garden, soft daylight
аниме|аниме пейзаж => an anime style landscape: a quiet Japanese town street at sunset with power lines, a small shrine and cherry trees, vivid sky, detailed illustration
аниме девушка|аниме девушку|аниме-девушку|аниме тян|тянку => an anime style illustration of a young adult woman with long flowing hair, big expressive eyes and a gentle smile, wearing a cozy sweater, cherry blossoms behind, soft pastel colors, detailed

# чувства
любовь => a photo of two hands forming a heart shape against a warm sunset sky over the sea, soft golden light
счастье => a photo of a sunlit summer meadow with dandelions and butterflies, a kite flying in the blue sky, bright joyful colors
радость => a photo of colorful balloons rising into a bright blue sky over a green field, sunlight, joyful mood
мечта|мечту => a dreamy landscape with a path leading over green hills to a glowing horizon, floating lanterns in a starry twilight sky, digital painting
дружба|дружбу => a photo of two friends sitting on a hill and watching the sunset together, seen from behind, warm light
одиночество => a cinematic photo of a lone bench under a street lamp in a foggy empty park at night, soft light
свобода|свободу => a landscape photo of a flock of birds flying over open mountains at sunrise, wide sky, rays of light
тишина|тишину|покой|спокойствие|умиротворение => a photo of a calm lake at dawn with perfect reflections, light mist, a small wooden boat, soft pastel sky
сон => a dreamy night scene: a crescent moon and fluffy clouds over a sleeping town, stars, soft blue and purple colors, illustration
грусть|печаль => a photo of raindrops on a window pane with blurred city lights behind, blue evening tones
надежда|надежду => a macro photo of a small green sprout growing through cracked dry earth, sun rays, soft light
уют => a photo of a cozy corner by a window on a rainy evening: an armchair with a plaid, a cup of tea, a book, string lights, a sleeping cat
рай|джаннат => a paradise garden: lush green trees with fruit, rivers of clear water, flowers and soft golden light, peaceful digital painting

# вера
мечеть => a wide photo of a beautiful mosque with a large dome and tall slender minarets with crescents on top, an arched entrance with geometric ornaments, palm trees, clear sky at sunset
коран|священный коран => a photo of the Holy Quran, a closed book with an ornate green and gold cover, resting on a carved wooden stand, prayer beads beside it, soft light from a window
намаз|молитва|молитву => a photo of a man in a white robe and cap, seen from behind, standing in prayer on a prayer rug in a quiet mosque hall with carpets, columns and soft light from arched windows
коврик для намаза|молитвенный коврик|намазлык => a photo of a prayer rug with rich geometric patterns on the floor of a quiet room, soft light from an arched window, prayer beads on the rug
четки => a photo of wooden prayer beads with a tassel lying on an open book, soft warm light, fine detail
полумесяц => a photo of a thin crescent moon in a deep blue evening sky above the silhouette of a mosque dome and minarets, first stars
рамадан|рамазан => Ramadan evening: glowing ornate lanterns and a crescent moon above a mosque silhouette at dusk, dates and a glass of water on a table in the foreground, warm light
ифтар => a photo of an iftar table at sunset: dates, water, soup, bread and fruits on a patterned tablecloth, glowing lanterns, a mosque silhouette through the window, warm light
хадж => a wide photo from above of pilgrims in white clothes walking in a circle around the Kaaba, the black cube with a gold band, in the marble courtyard of the Grand Mosque in Mecca, evening lights
минарет => a photo of a tall slender minaret with a balcony and a crescent on top against a sunset sky, a mosque dome beside it

# места
мекка|мекку|мекке|мекки|кааба|каабу|каабе|каабы|аль-харам|мечеть аль-харам|заповедная мечеть|заповедную мечеть => the Kaaba in Mecca: a large black cube-shaped building draped in black cloth with a band of gold calligraphy, standing in the centre of the white marble courtyard of the Grand Mosque, thousands of pilgrims in white walking around it, tall white minarets, evening light, wide photo
медина|медину|медине|медины|мечеть пророка|мечеть ан-набави => the Prophet's Mosque in Medina: a vast white mosque with a green dome, tall slender minarets and large white umbrella canopies over the marble courtyard, evening light, wide photo
арафат|гора арафат|гору арафат => Mount Arafat near Mecca: a rocky granite hill with a white pillar on top, pilgrims in white clothes standing on the slopes, bright daylight, wide photo
иерусалим|купол скалы => the Dome of the Rock in Jerusalem: an octagonal building with blue ornamental tiles and a large golden dome on a stone plaza, old city walls, clear sky, wide photo
аль-акса|мечеть аль-акса => the Al-Aqsa Mosque in the Old City of Jerusalem: a stone mosque with a silver-grey dome and an arched facade, the golden Dome of the Rock nearby, olive trees, a stone plaza, clear sky, wide photo
стамбул|голубая мечеть|голубую мечеть => Istanbul: the Blue Mosque with cascading domes and six slender minarets seen across a garden with a fountain, the Bosphorus in the distance, sunset sky, wide photo
айя-софия|айя-софию|святая софия => Hagia Sophia in Istanbul: a huge ancient building with a great central dome, smaller domes and four minarets, a garden with a fountain in front, soft evening light, wide photo
казань|кул-шариф|кул шариф => the Kul Sharif Mosque in the Kazan Kremlin: a white mosque with turquoise-blue domes and four tall minarets, white kremlin walls, blue sky, wide photo
грозный|сердце чечни => the Heart of Chechnya mosque in Grozny: a large Ottoman-style mosque with a central dome and four tall minarets, fountains and a park in front, modern towers behind, evening lights, wide photo
мечеть шейха зайда|абу-даби => Sheikh Zayed Grand Mosque in Abu Dhabi: a white marble mosque with many domes, arcades with golden columns and reflecting pools, blue evening sky, wide photo
самарканд|регистан => Registan Square in Samarkand: three grand madrasahs with blue-tiled portals, turquoise domes and minarets around a stone square, clear sky, warm evening light, wide photo
бухара|бухару => the old city of Bukhara: the tall Kalyan minaret of baked brick beside a mosque with turquoise domes and a tiled portal, clear sky, warm evening light, wide photo
москва|москву|кремль|красная площадь|красную площадь => Moscow: Red Square with the colorful onion domes of St. Basil's Cathedral and the red brick Kremlin wall with the Spasskaya clock tower, evening light, wide photo
санкт-петербург|петербург|питер => Saint Petersburg: the Neva embankment with the Winter Palace and a raised drawbridge in a white night, soft pink sky, wide photo
париж|эйфелева башня|эйфелеву башню => Paris: the Eiffel Tower rising above the Seine river and old Parisian buildings, trees along the embankment, golden sunset sky, wide photo
лондон|биг-бен|биг бен => London: the Big Ben clock tower and the Houses of Parliament by the river Thames with Westminster Bridge and a red double-decker bus, evening light, wide photo
нью-йорк|статуя свободы|статую свободы => New York: the Statue of Liberty on its island with the Manhattan skyline of skyscrapers behind, blue water, clear sky, wide photo
токио => Tokyo at dusk: a busy street with bright neon signs, a crossing full of people with umbrellas, tall buildings, reflections on wet asphalt, wide photo
фудзи|фудзияма|фудзияму|гора фудзи|гору фудзи|япония|японию => Mount Fuji with a snow-capped peak above a calm lake, a red pagoda and blossoming cherry trees in the foreground, clear sky, photo
дубай|бурдж-халифа|бурдж халифа => the Dubai skyline with the very tall Burj Khalifa skyscraper, modern towers, fountains and a lake at dusk, city lights, wide photo
каир|египет|пирамиды|пирамида|пирамиду => the Great Pyramids of Giza in the Egyptian desert, the Sphinx in front, camels with riders on the sand, clear blue sky, warm light, wide photo
рим|колизей => the Colosseum in Rome: an ancient stone amphitheatre with rows of arches, blue sky, warm evening light, wide photo
венеция|венецию => Venice: the Grand Canal with gondolas, old palaces along the water and the Rialto Bridge, soft sunset light, wide photo
тадж-махал|тадж махал => the Taj Mahal in India: a white marble mausoleum with a large dome and four minarets, a long reflecting pool and gardens in front, soft sunrise light, wide photo
великая китайская стена|китайская стена|китайскую стену|великую китайскую стену => the Great Wall of China winding over green mountain ridges with watchtowers, morning mist, wide landscape photo
амстердам|нидерланды|голландия|голландию => Amsterdam: a canal lined with narrow tall Dutch houses, bicycles on a bridge, boats on the water, trees, soft evening light, photo
мельница|мельницу|ветряная мельница|ветряную мельницу => a traditional Dutch windmill beside a canal with green fields and tulips, blue sky with clouds, sunny day, photo
байкал => Lake Baikal in winter: clear turquoise ice with cracks and bubbles, a rocky island with pine trees, blue sky, wide landscape photo
эльбрус|кавказ|кавказские горы => Mount Elbrus with its two snowy peaks rising above the green alpine meadows of the Caucasus, clear sky, morning light, wide landscape photo
дагестан|сулакский каньон => the Sulak Canyon in Dagestan: a deep rocky canyon with a winding turquoise river far below, mountain ridges, clear sky, wide landscape photo
алтай => the Altai mountains: a turquoise river in a green valley with larch forest, snowy peaks in the distance, clear sky, wide landscape photo
камчатка|камчатку => Kamchatka: a snow-capped cone volcano with a plume of steam above a green tundra valley and a lake, clear sky, wide landscape photo
крым => the Crimean coast: a small castle on the edge of a high sea cliff above blue water, pine trees, sunny day, wide photo
`;

/** Просьба одним видом: строчные, «ё» → «е», без знаков по краям, один пробел. */
export const foldSubject = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е")
  .replace(/[«»"“”„()!?…]+/gu, " ").replace(/[.,;:]+(?=\s|$)/gu, " ").replace(/\s+/gu, " ").trim();

/** Строки словаря: `{ title, forms, prompt, place, group }`; `title` — первая форма, как она пишется. */
export const SUBJECTS = Object.freeze((() => {
  const rows = [];
  let group = "";
  for (const raw of TABLE.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) { group = line.slice(1).trim(); continue; }
    const at = line.indexOf(" => ");
    if (at < 0) continue;
    const written = line.slice(0, at).split("|").map(item => item.trim()).filter(Boolean);
    const forms = written.map(item => foldSubject(item)).filter(Boolean);
    rows.push(Object.freeze({ title: written[0], forms: Object.freeze(forms), prompt: line.slice(at + 4).trim(), place: group === "места", group }));
  }
  return rows;
})());

const INDEX = new Map();
for (const row of SUBJECTS) for (const form of row.forms) if (!INDEX.has(form)) INDEX.set(form, row);
/** Названия мест от длинных к коротким: «гора Арафат» раньше, чем «Арафат». */
const PLACE_FORMS = [...INDEX.entries()].filter(([, row]) => row.place).sort((a, b) => b[0].length - a[0].length);

/** Слова вежливости и «мне» вокруг просьбы: «мне кота, пожалуйста» — это «кота». */
const POLITE = /^(?:(?:мне|нам|пожалуйста|пж|плиз|просто|красиво|красивую|красивого|красивый|красивое|красивые)\s+)+|(?:\s+(?:пожалуйста|пж|плиз|мне|нам|красиво))+$/gu;

/** Вся просьба — одно знакомое слово или название: строка словаря, иначе null. */
export function subjectFor(text) {
  const value = foldSubject(text).replace(POLITE, "").trim();
  return value ? INDEX.get(value) ?? null : null;
}

/** Знакомые места внутри длинной просьбы — не больше двух, каждое один раз. */
export function placesIn(text, limit = 2) {
  const value = ` ${foldSubject(text).replace(/[^a-zа-я0-9-]+/gu, " ")} `;
  const found = new Map();
  for (const [form, row] of PLACE_FORMS) {
    const at = value.indexOf(` ${form} `);
    if (at >= 0 && !(found.get(row) <= at)) found.set(row, at);
  }
  // В том порядке, в каком места названы.
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([row]) => row);
}

/**
 * Что можно загадать рисунком («угадай рисунок»): один предмет, зверь или герой,
 * который на картинке ни с чем не спутать. Пейзажи не годятся: закат над морем —
 * это «закат» или «море»? Из пар «кот — котёнок», «собака — щенок», «корабль —
 * лодка», «орёл — сокол» оставлено по одному: иначе верный ответ был бы «неверным».
 */
const RIDDLE_NATURE = new Set(["радуга", "луна", "водопад", "вулкан", "роза", "тюльпан", "ромашка", "подсолнух", "пальма", "остров", "пещера", "дерево"]);
const RIDDLE_SKIP = new Set(["котенок", "щенок", "птица", "сокол", "лодка", "мышь", "комната", "кухня", "город", "деревня", "сад", "аниме", "девушка", "парень", "бабушка", "дедушка", "привидение", "сердце", "звезда", "чай", "кофе", "фрукты"]);
export const GUESSABLE = Object.freeze(SUBJECTS.filter(row => !row.forms[0].includes(" ") && !RIDDLE_SKIP.has(row.forms[0])
  && (row.group === "звери" || row.group === "вещи и сцены" || row.group === "герои" || (row.group === "природа" && RIDDLE_NATURE.has(row.forms[0])))));
