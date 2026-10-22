/** Fictional name pools grouped by broad cultural region, with nationalities. */
export interface NameRegion {
  weight: number;
  nationalities: readonly string[];
  first: readonly string[];
  last: readonly string[];
}

export const NAME_REGIONS: readonly NameRegion[] = [
  {
    weight: 4,
    nationalities: ['England', 'Scotland', 'Wales', 'Ireland'],
    first: ['Oliver', 'Harry', 'Jack', 'Callum', 'Rhys', 'Finley', 'Owen', 'Liam', 'Connor', 'Ethan', 'Archie', 'Lewis', 'Toby', 'Jamie', 'Ben'],
    last: ['Ashworth', 'Pembridge', 'Calloway', 'Hartley', 'Dunmore', 'Fairbairn', 'Kettering', 'Lockhart', 'Marlowe', 'Penrose', 'Rowntree', 'Thackeray', 'Whitlock', 'Brennan', 'Gallagher', 'McAllister'],
  },
  {
    weight: 2,
    nationalities: ['Spain', 'Argentina', 'Uruguay', 'Colombia', 'Mexico'],
    first: ['Mateo', 'Santiago', 'Diego', 'Álvaro', 'Nicolás', 'Tomás', 'Joaquín', 'Iker', 'Emiliano', 'Bruno', 'Facundo'],
    last: ['Arriaga', 'Benavídez', 'Castellanos', 'Echeverri', 'Ferreyra', 'Iturbe', 'Montoya', 'Olivera', 'Quintero', 'Salcedo', 'Villalba'],
  },
  {
    weight: 2,
    nationalities: ['Nigeria', 'Ghana', 'Senegal', "Côte d'Ivoire", 'Cameroon'],
    first: ['Kwame', 'Chidi', 'Moussa', 'Kofi', 'Ibrahima', 'Emeka', 'Yaw', 'Sadio', 'Tunde', 'Obi', 'Cheikh'],
    last: ['Adeyemi', 'Boateng', 'Diallo', 'Mensah', 'Okafor', 'Ndiaye', 'Asante', 'Eze', 'Kouassi', 'Sarr', 'Owusu'],
  },
  {
    weight: 1.5,
    nationalities: ['France', 'Belgium', 'Netherlands'],
    first: ['Lucas', 'Théo', 'Hugo', 'Milan', 'Jules', 'Daan', 'Sem', 'Noah', 'Rayan', 'Bastien'],
    last: ['Delacroix', 'Moreau', 'Lefebvre', 'Vermeulen', 'de Groot', 'Janssens', 'Bakker', 'Fontaine', 'Rousseau', 'Peeters'],
  },
  {
    weight: 1.2,
    nationalities: ['Germany', 'Austria', 'Denmark', 'Norway', 'Sweden'],
    first: ['Jonas', 'Felix', 'Lukas', 'Magnus', 'Emil', 'Anders', 'Nils', 'Leon', 'Erik', 'Mads'],
    last: ['Brandt', 'Hoffmann', 'Lindqvist', 'Sørensen', 'Halvorsen', 'Weber', 'Kessler', 'Andersen', 'Strand', 'Vogel'],
  },
  {
    weight: 1.2,
    nationalities: ['Brazil', 'Portugal'],
    first: ['João', 'Gabriel', 'Rafael', 'Thiago', 'Vinícius', 'Rodrigo', 'Gonçalo', 'Davi', 'Caio'],
    last: ['Albuquerque', 'Carvalho', 'Figueiredo', 'Moura', 'Nascimento', 'Pereira', 'Ribeiro', 'Teixeira', 'Valadares'],
  },
  {
    weight: 1,
    nationalities: ['Japan', 'South Korea'],
    first: ['Haruto', 'Ren', 'Sota', 'Minjun', 'Jiho', 'Daiki', 'Yuto', 'Seojun'],
    last: ['Takeda', 'Morimoto', 'Hayashi', 'Kang', 'Shin', 'Nakamura', 'Ishikawa', 'Yoon'],
  },
  {
    weight: 1,
    nationalities: ['Morocco', 'Algeria', 'Turkey', 'Egypt'],
    first: ['Yusuf', 'Amine', 'Karim', 'Emre', 'Omar', 'Bilal', 'Ilyas', 'Kerem', 'Hamza'],
    last: ['Benali', 'El Amrani', 'Yıldız', 'Haddad', 'Mansour', 'Aksoy', 'Bouzid', 'Khalil', 'Demir'],
  },
  {
    weight: 1,
    nationalities: ['Poland', 'Croatia', 'Serbia', 'Ukraine'],
    first: ['Jakub', 'Luka', 'Marko', 'Filip', 'Mateusz', 'Andriy', 'Ivan', 'Dominik'],
    last: ['Kowalczyk', 'Horvat', 'Petrović', 'Nowicki', 'Bondarenko', 'Jurić', 'Zieliński', 'Kovalenko'],
  },
  {
    weight: 1,
    nationalities: ['United States', 'Canada', 'Jamaica'],
    first: ['Tyler', 'Jordan', 'Malik', 'Devon', 'Cameron', 'Andre', 'Isaiah', 'Marcus'],
    last: ['Whitaker', 'Ellison', 'Bramwell', 'Grayson', 'Holloway', 'Reid', 'Sinclair', 'Thornton'],
  },
];
